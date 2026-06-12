package emails

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// maxWebhookBody caps how much of an unauthenticated webhook body is read
// before the signature check; a real Mailgun event is a few KB.
const maxWebhookBody = 1 << 20

// maxSignatureAge is how old (or how far in the future, allowing clock skew)
// a webhook signature timestamp may be. Mailgun signs timestamp+token, so
// without a freshness check a captured payload would validate forever; this
// bounds the replay window, as Mailgun's own docs recommend.
const maxSignatureAge = 5 * time.Minute

// Webhook handles Mailgun delivery event callbacks: it verifies the webhook
// signature, matches the recipient row by Mailgun message id, and upgrades its
// status to delivered, bounced, or failed.
type Webhook struct {
	db *bun.DB
	// signingKey is Mailgun's webhook signing key. Empty means webhooks are
	// not configured; every callback is rejected as unauthorized.
	signingKey string
}

// NewWebhook builds a Webhook backed by the given DB and Mailgun webhook
// signing key.
func NewWebhook(db *bun.DB, signingKey string) *Webhook {
	return &Webhook{db: db, signingKey: signingKey}
}

// RegisterWebhookRoutes mounts the Mailgun delivery webhook on the given
// group, expected to be the open /api group: Mailgun calls it, so there is no
// JWT; the HMAC signature on the payload is the authentication.
func RegisterWebhookRoutes(g *echo.Group, w *Webhook) {
	g.POST("/webhooks/mailgun", w.handle)
}

// webhookPayload is the slice of Mailgun's webhook body we consume. Decoded
// leniently with encoding/json rather than the strict binder: Mailgun attaches
// dozens of fields we ignore, and unknown keys must not fail the request.
type webhookPayload struct {
	Signature struct {
		Timestamp string `json:"timestamp"`
		Token     string `json:"token"`
		Signature string `json:"signature"`
	} `json:"signature"`
	EventData struct {
		Event          string `json:"event"`
		Severity       string `json:"severity"`
		Reason         string `json:"reason"`
		DeliveryStatus struct {
			Message     string `json:"message"`
			Description string `json:"description"`
		} `json:"delivery-status"`
		Message struct {
			Headers struct {
				MessageID string `json:"message-id"`
			} `json:"headers"`
		} `json:"message"`
		// UserVariables echoes back the custom variables attached at send
		// time; recipient_id is the email_recipients row id (see Message).
		UserVariables struct {
			RecipientID string `json:"recipient_id"`
		} `json:"user-variables"`
	} `json:"event-data"`
}

// handle processes one delivery event. Any 2xx tells Mailgun the event is
// consumed; it retries non-2xx responses. Events we don't track (opened,
// clicked, temporary failures) and message ids we don't know are acknowledged
// without effect, since retrying them could never succeed differently.
func (w *Webhook) handle(c echo.Context) error {
	var payload webhookPayload
	if err := json.NewDecoder(io.LimitReader(c.Request().Body, maxWebhookBody)).Decode(&payload); err != nil {
		return errcodes.BadRequest("The webhook payload is not valid JSON.")
	}

	if !w.signatureValid(payload) {
		return errcodes.Unauthorized("Invalid webhook signature.")
	}

	status, reason, tracked := mapDeliveryEvent(payload)
	if !tracked {
		return c.NoContent(http.StatusNoContent)
	}
	// Cap the stored reason like the worker's markFailed does; the JSON
	// decoder already guarantees valid UTF-8, but the trailing rune can be
	// split by the byte cap.
	if len(reason) > maxFailureReason {
		reason = strings.ToValidUTF8(reason[:maxFailureReason], "")
	}

	messageID := normalizeMessageID(payload.EventData.Message.Headers.MessageID)
	if messageID == "" {
		return c.NoContent(http.StatusNoContent)
	}

	// applyEvent stamps the event's outcome onto whatever rows q selects. A
	// delivery clears any stale failure reason (the worker's sent path does
	// the same), so a failed-then-delivered pair cannot leave a reason next
	// to a delivered status.
	applyEvent := func(q *bun.UpdateQuery) *bun.UpdateQuery {
		q = q.Set("status = ?", status).Set("updated_at = now()")
		if status == models.EmailDelivered {
			q = q.Set("failure_reason = NULL")
		} else if reason != "" {
			q = q.Set("failure_reason = ?", reason)
		}
		return q
	}

	res, err := applyEvent(w.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
		Where("mailgun_message_id = ?", messageID)).
		Exec(c.Request().Context())
	if err != nil {
		return errors.Wrap(err, "update email recipient from webhook")
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		w.applyByRecipientID(c, payload, applyEvent, messageID)
	}
	return c.NoContent(http.StatusNoContent)
}

// applyByRecipientID is the fallback match when no row carries the event's
// message id yet: a webhook can outrun the worker's own status write, or
// arrive while a crashed send sits in `sending` with no message id, and
// dropping the event would lose the delivery outcome for good (Mailgun does
// not retry acknowledged events). The recipient_id custom variable echoed
// back in the event identifies the row directly, and the same write records
// the message id the row was missing. Failures are logged, not returned: by
// this point the event is matched as well as it ever can be, and a non-2xx
// would only make Mailgun retry into the same outcome.
func (w *Webhook) applyByRecipientID(c echo.Context, payload webhookPayload, applyEvent func(*bun.UpdateQuery) *bun.UpdateQuery, messageID string) {
	log := logger.FromContext(c.Request().Context())
	// A missing variable is not an error (e.g. an event for a message sent
	// outside this system), and a malformed one can never name a row, so
	// neither should reach Postgres as a failing text-to-uuid cast. The
	// parsed canonical form is what gets bound: uuid.Parse accepts variants
	// (urn:uuid:, braces) that Postgres's uuid input does not.
	parsed, err := uuid.Parse(payload.EventData.UserVariables.RecipientID)
	if err != nil {
		log.Warn("mailgun webhook matched no recipient", logger.Data{
			"mailgun_message_id": messageID,
			"event":              payload.EventData.Event,
		})
		return
	}
	recipientID := parsed.String()
	res, err := applyEvent(w.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
		Set("mailgun_message_id = ?", messageID).
		Where("id = ?", recipientID)).
		Exec(c.Request().Context())
	if err != nil {
		log.Err(err).Error("mailgun webhook recipient-id update failed", logger.Data{
			"recipient_id": recipientID,
		})
		return
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		// Not an error: e.g. a recipient row removed with its guest.
		log.Warn("mailgun webhook matched no recipient", logger.Data{
			"mailgun_message_id": messageID,
			"recipient_id":       recipientID,
			"event":              payload.EventData.Event,
		})
	}
}

// signatureValid checks Mailgun's webhook signature: HMAC-SHA256 of
// timestamp+token under the signing key, hex-encoded, compared in constant
// time, with the timestamp required to fall within maxSignatureAge of now so
// a captured payload cannot be replayed indefinitely. An unconfigured (empty)
// signing key validates nothing.
func (w *Webhook) signatureValid(payload webhookPayload) bool {
	if w.signingKey == "" {
		return false
	}
	sig := payload.Signature
	ts, err := strconv.ParseInt(sig.Timestamp, 10, 64)
	if err != nil {
		return false
	}
	if age := time.Since(time.Unix(ts, 0)); age > maxSignatureAge || age < -maxSignatureAge {
		return false
	}
	mac := hmac.New(sha256.New, []byte(w.signingKey))
	mac.Write([]byte(sig.Timestamp + sig.Token))
	expected := hex.EncodeToString(mac.Sum(nil))
	return hmac.Equal([]byte(expected), []byte(sig.Signature))
}

// mapDeliveryEvent translates a Mailgun event into our recipient status.
// delivered maps directly; a permanent failure is a bounce when Mailgun's
// reason says so and a plain failure otherwise. Temporary failures are not
// tracked: Mailgun keeps retrying them itself, so the row's fate is still
// undecided. The reason string (for bounced/failed) prefers the SMTP
// description over the bare reason code.
func mapDeliveryEvent(payload webhookPayload) (status, reason string, tracked bool) {
	data := payload.EventData
	switch data.Event {
	case "delivered":
		return models.EmailDelivered, "", true
	case "failed":
		if data.Severity != "permanent" {
			return "", "", false
		}
		status = models.EmailFailed
		if data.Reason == "bounce" || data.Reason == "suppress-bounce" {
			status = models.EmailBounced
		}
		reason = data.DeliveryStatus.Description
		if reason == "" {
			reason = data.DeliveryStatus.Message
		}
		if reason == "" {
			reason = data.Reason
		}
		return status, reason, true
	default:
		return "", "", false
	}
}
