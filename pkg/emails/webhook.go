package emails

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

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
	} `json:"event-data"`
}

// handle processes one delivery event. Any 2xx tells Mailgun the event is
// consumed; it retries non-2xx responses. Events we don't track (opened,
// clicked, temporary failures) and message ids we don't know are acknowledged
// without effect, since retrying them could never succeed differently.
func (w *Webhook) handle(c echo.Context) error {
	var payload webhookPayload
	if err := json.NewDecoder(c.Request().Body).Decode(&payload); err != nil {
		return errcodes.BadRequest("The webhook payload is not valid JSON.")
	}

	if !w.signatureValid(payload) {
		return errcodes.Unauthorized("Invalid webhook signature.")
	}

	status, reason, tracked := mapDeliveryEvent(payload)
	if !tracked {
		return c.NoContent(http.StatusNoContent)
	}

	messageID := normalizeMessageID(payload.EventData.Message.Headers.MessageID)
	if messageID == "" {
		return c.NoContent(http.StatusNoContent)
	}

	q := w.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
		Set("status = ?", status).
		Set("updated_at = now()").
		Where("mailgun_message_id = ?", messageID)
	if reason != "" {
		q = q.Set("failure_reason = ?", reason)
	}
	res, err := q.Exec(c.Request().Context())
	if err != nil {
		return errors.Wrap(err, "update email recipient from webhook")
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		// Not an error: e.g. an event for a message sent outside this system,
		// or a recipient row removed with its guest. Log for visibility.
		logger.FromContext(c.Request().Context()).Warn("mailgun webhook matched no recipient", logger.Data{
			"mailgun_message_id": messageID,
			"event":              payload.EventData.Event,
		})
	}
	return c.NoContent(http.StatusNoContent)
}

// signatureValid checks Mailgun's webhook signature: HMAC-SHA256 of
// timestamp+token under the signing key, hex-encoded, compared in constant
// time. An unconfigured (empty) signing key validates nothing.
func (w *Webhook) signatureValid(payload webhookPayload) bool {
	if w.signingKey == "" {
		return false
	}
	sig := payload.Signature
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
