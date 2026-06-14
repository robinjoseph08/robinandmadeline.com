package emails_test

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const testSigningKey = "test-signing-key"

// newWebhookAPI wires the webhook route onto a bare Echo instance with the
// shared error handler. The webhook does not use the strict binder (Mailgun
// payloads carry unknown fields), so none is installed.
func newWebhookAPI(t *testing.T, signingKey string) (*echo.Echo, fixtures) {
	t.Helper()
	f := newFixtures(t)
	e := echo.New()
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	emails.RegisterWebhookRoutes(e.Group("/api"), emails.NewWebhook(f.db, signingKey))
	return e, f
}

// sign computes a valid Mailgun webhook signature block for the given key.
func sign(key, timestamp, token string) string {
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(timestamp + token))
	return hex.EncodeToString(mac.Sum(nil))
}

// webhookBody builds a Mailgun delivery event payload, signed with a current
// timestamp (the handler rejects stale ones as replays). messageID is the
// bare (bracket-less) form Mailgun webhooks carry. extra merges additional
// event-data fields (severity, reason, delivery-status, user-variables).
func webhookBody(key, event, messageID string, extra map[string]any) map[string]any {
	return webhookBodyAt(key, event, messageID, time.Now(), extra)
}

// webhookBodyAt is webhookBody with an explicit signature timestamp, for
// replay tests.
func webhookBodyAt(key, event, messageID string, signedAt time.Time, extra map[string]any) map[string]any {
	timestamp := strconv.FormatInt(signedAt.Unix(), 10)
	const token = "token-abc"
	eventData := map[string]any{
		"event":   event,
		"message": map[string]any{"headers": map[string]any{"message-id": messageID}},
		// A field our payload struct does not model, proving lenient decoding.
		"log-level": "info",
	}
	for k, v := range extra {
		eventData[k] = v
	}
	return map[string]any{
		"signature": map[string]any{
			"timestamp": timestamp,
			"token":     token,
			"signature": sign(key, timestamp, token),
		},
		"event-data": eventData,
	}
}

// postWebhook sends a JSON body to the webhook endpoint.
func postWebhook(t *testing.T, e *echo.Echo, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, err := json.Marshal(body)
	require.NoError(t, err)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/webhooks/mailgun", bytes.NewReader(b))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// sentRecipient creates a send with one recipient and marks it sent with the
// given Mailgun message id, the state a delivery webhook finds it in.
func sentRecipient(t *testing.T, f fixtures, messageID string) *models.EmailRecipient {
	t.Helper()
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	send, _, err := f.emails.CreateSend(ctx(), emails.SendEmailPayload{Subject: "s", Body: "b"})
	require.NoError(t, err)
	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	_, err = f.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
		Set("status = ?", models.EmailSent).
		Set("mailgun_message_id = ?", messageID).
		Where("id = ?", row.ID).Exec(ctx())
	require.NoError(t, err)
	return row
}

// reloadRecipient reads a recipient row back from the DB.
func reloadRecipient(t *testing.T, f fixtures, id string) *models.EmailRecipient {
	t.Helper()
	row := new(models.EmailRecipient)
	require.NoError(t, f.db.NewSelect().Model(row).Where("erc.id = ?", id).Scan(ctx()))
	return row
}

func TestWebhook_DeliveredEventUpgradesStatus(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-1@mg.example.test")

	rec := postWebhook(t, e, webhookBody(testSigningKey, "delivered", "mid-1@mg.example.test", nil))
	assert.Equal(t, http.StatusNoContent, rec.Code)

	got := reloadRecipient(t, f, row.ID)
	assert.Equal(t, models.EmailDelivered, got.Status)
	assert.Nil(t, got.FailureReason)
}

func TestWebhook_PermanentBounceMapsToBounced(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-2@mg.example.test")

	rec := postWebhook(t, e, webhookBody(testSigningKey, "failed", "mid-2@mg.example.test", map[string]any{
		"severity": "permanent",
		"reason":   "bounce",
		"delivery-status": map[string]any{
			"message":     "550 5.1.1 The email account does not exist",
			"description": "The email account that you tried to reach does not exist",
		},
	}))
	assert.Equal(t, http.StatusNoContent, rec.Code)

	got := reloadRecipient(t, f, row.ID)
	assert.Equal(t, models.EmailBounced, got.Status)
	require.NotNil(t, got.FailureReason)
	assert.Contains(t, *got.FailureReason, "does not exist")
}

func TestWebhook_PermanentNonBounceFailureMapsToFailed(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-3@mg.example.test")

	rec := postWebhook(t, e, webhookBody(testSigningKey, "failed", "mid-3@mg.example.test", map[string]any{
		"severity": "permanent",
		"reason":   "generic",
	}))
	assert.Equal(t, http.StatusNoContent, rec.Code)

	got := reloadRecipient(t, f, row.ID)
	assert.Equal(t, models.EmailFailed, got.Status)
	require.NotNil(t, got.FailureReason)
	assert.Equal(t, "generic", *got.FailureReason)
}

func TestWebhook_TemporaryFailureIsIgnored(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-4@mg.example.test")

	// Mailgun keeps retrying temporary failures itself; the row's fate is
	// undecided, so its status must not move.
	rec := postWebhook(t, e, webhookBody(testSigningKey, "failed", "mid-4@mg.example.test", map[string]any{
		"severity": "temporary",
		"reason":   "generic",
	}))
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, models.EmailSent, reloadRecipient(t, f, row.ID).Status)
}

func TestWebhook_UntrackedEventIsAcknowledged(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-5@mg.example.test")

	rec := postWebhook(t, e, webhookBody(testSigningKey, "opened", "mid-5@mg.example.test", nil))
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, models.EmailSent, reloadRecipient(t, f, row.ID).Status)
}

func TestWebhook_InvalidSignatureIs401AndRowUntouched(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-6@mg.example.test")

	body := webhookBody("wrong-key", "delivered", "mid-6@mg.example.test", nil)
	rec := postWebhook(t, e, body)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, models.EmailSent, reloadRecipient(t, f, row.ID).Status)
}

func TestWebhook_UnconfiguredSigningKeyRejectsEverything(t *testing.T) {
	// The server has no signing key configured; even a payload "signed" with
	// an empty key must be rejected rather than validated against it.
	e, f := newWebhookAPI(t, "")
	row := sentRecipient(t, f, "mid-7@mg.example.test")

	rec := postWebhook(t, e, webhookBody("", "delivered", "mid-7@mg.example.test", nil))
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, models.EmailSent, reloadRecipient(t, f, row.ID).Status)
}

func TestWebhook_UnknownMessageIDIsAcknowledged(t *testing.T) {
	e, _ := newWebhookAPI(t, testSigningKey)
	rec := postWebhook(t, e, webhookBody(testSigningKey, "delivered", "unknown@mg.example.test", nil))
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWebhook_StaleTimestampIsRejectedAsReplay(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-9@mg.example.test")

	// Correctly signed, but an hour old: a captured payload must not validate
	// forever, so the freshness window rejects it.
	body := webhookBodyAt(testSigningKey, "delivered", "mid-9@mg.example.test", time.Now().Add(-time.Hour), nil)
	rec := postWebhook(t, e, body)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, models.EmailSent, reloadRecipient(t, f, row.ID).Status)
}

func TestWebhook_SuppressBounceMapsToBounced(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-10@mg.example.test")

	rec := postWebhook(t, e, webhookBody(testSigningKey, "failed", "mid-10@mg.example.test", map[string]any{
		"severity": "permanent",
		"reason":   "suppress-bounce",
		"delivery-status": map[string]any{
			"message": "Not delivering to previously bounced address",
		},
	}))
	assert.Equal(t, http.StatusNoContent, rec.Code)

	got := reloadRecipient(t, f, row.ID)
	assert.Equal(t, models.EmailBounced, got.Status)
	// With no description, the reason falls back to delivery-status.message.
	require.NotNil(t, got.FailureReason)
	assert.Equal(t, "Not delivering to previously bounced address", *got.FailureReason)
}

func TestWebhook_NoMessageIDMatchFallsBackToRecipientIDVariable(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "ignored@mg.example.test")
	// The row is mid-crash: stuck in `sending` with no message id recorded
	// (the worker died between Mailgun accepting and the status write). The
	// delivered webhook can still land via the echoed recipient_id custom
	// variable, and it backfills the missing message id.
	_, err := f.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
		Set("status = ?", models.EmailSending).
		Set("mailgun_message_id = NULL").
		Where("id = ?", row.ID).Exec(ctx())
	require.NoError(t, err)

	rec := postWebhook(t, e, webhookBody(testSigningKey, "delivered", "late-mid@mg.example.test", map[string]any{
		"user-variables": map[string]any{"recipient_id": row.ID},
	}))
	assert.Equal(t, http.StatusNoContent, rec.Code)

	got := reloadRecipient(t, f, row.ID)
	assert.Equal(t, models.EmailDelivered, got.Status)
	require.NotNil(t, got.MailgunMessageID)
	assert.Equal(t, "late-mid@mg.example.test", *got.MailgunMessageID)
}

func TestWebhook_OverlongFailureReasonIsCapped(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-11@mg.example.test")

	rec := postWebhook(t, e, webhookBody(testSigningKey, "failed", "mid-11@mg.example.test", map[string]any{
		"severity": "permanent",
		"reason":   "generic",
		"delivery-status": map[string]any{
			"description": strings.Repeat("x", 5000),
		},
	}))
	assert.Equal(t, http.StatusNoContent, rec.Code)

	got := reloadRecipient(t, f, row.ID)
	assert.Equal(t, models.EmailFailed, got.Status)
	require.NotNil(t, got.FailureReason)
	assert.Len(t, *got.FailureReason, 1000)
}

func TestWebhook_MalformedRecipientIDVariableIsAcknowledged(t *testing.T) {
	e, _ := newWebhookAPI(t, testSigningKey)

	// A recipient_id that is not a UUID can never name a row; it must be
	// acknowledged without reaching Postgres as a failing uuid cast.
	rec := postWebhook(t, e, webhookBody(testSigningKey, "delivered", "unknown@mg.example.test", map[string]any{
		"user-variables": map[string]any{"recipient_id": "not-a-uuid"},
	}))
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestWebhook_RecipientIDVariantFormIsCanonicalizedBeforeMatching(t *testing.T) {
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "ignored-2@mg.example.test")
	_, err := f.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
		Set("status = ?", models.EmailSending).
		Set("mailgun_message_id = NULL").
		Where("id = ?", row.ID).Exec(ctx())
	require.NoError(t, err)

	// uuid.Parse accepts forms (e.g. the urn:uuid: prefix) that Postgres's
	// uuid input rejects; the fallback must bind the canonical parsed form so
	// a variant still matches the row instead of failing the cast.
	rec := postWebhook(t, e, webhookBody(testSigningKey, "delivered", "variant-mid@mg.example.test", map[string]any{
		"user-variables": map[string]any{"recipient_id": "urn:uuid:" + row.ID},
	}))
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, models.EmailDelivered, reloadRecipient(t, f, row.ID).Status)
}

func TestWebhook_OversizedBodyIsRejected(t *testing.T) {
	e, _ := newWebhookAPI(t, testSigningKey)

	// The endpoint is unauthenticated, so the body is capped before any
	// parsing: a payload larger than the cap reads as truncated JSON and is a
	// 400, not a buffered megabyte-eating decode.
	huge := `{"signature":{"timestamp":"x"},"padding":"` + strings.Repeat("a", 2<<20) + `"}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/webhooks/mailgun", strings.NewReader(huge))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestWebhook_MalformedJSONIs400(t *testing.T) {
	e, _ := newWebhookAPI(t, testSigningKey)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/webhooks/mailgun", bytes.NewReader([]byte("{not json")))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestWebhook_FailedThenDeliveredNeverHappensButStatusFollowsLatestEvent(t *testing.T) {
	// Mailgun events arrive in order per message; the row simply tracks the
	// most recent tracked event. This pins that there is no hidden ordering
	// logic to keep in sync, and that a delivery clears a stale failure
	// reason rather than leaving it beside a delivered status.
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-8@mg.example.test")

	postWebhook(t, e, webhookBody(testSigningKey, "failed", "mid-8@mg.example.test", map[string]any{
		"severity": "permanent",
		"reason":   "generic",
	}))
	require.NotNil(t, reloadRecipient(t, f, row.ID).FailureReason)

	postWebhook(t, e, webhookBody(testSigningKey, "delivered", "mid-8@mg.example.test", nil))
	got := reloadRecipient(t, f, row.ID)
	assert.Equal(t, models.EmailDelivered, got.Status)
	assert.Nil(t, got.FailureReason)
}

// Guard the fake against interface drift: if MailgunClient gains methods, the
// fake (and these tests) must be updated together.
var _ emails.MailgunClient = (*fakeMailgun)(nil)
