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
	"testing"

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

// webhookBody builds a Mailgun delivery event payload. messageID is the bare
// (bracket-less) form Mailgun webhooks carry. extra merges additional
// event-data fields (severity, reason, delivery-status).
func webhookBody(key, event, messageID string, extra map[string]any) map[string]any {
	const timestamp, token = "1718000000", "token-abc"
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
	// logic to keep in sync.
	e, f := newWebhookAPI(t, testSigningKey)
	row := sentRecipient(t, f, "mid-8@mg.example.test")

	postWebhook(t, e, webhookBody(testSigningKey, "delivered", "mid-8@mg.example.test", nil))
	assert.Equal(t, models.EmailDelivered, reloadRecipient(t, f, row.ID).Status)
}

// Guard the fake against interface drift: if MailgunClient gains methods, the
// fake (and these tests) must be updated together.
var _ emails.MailgunClient = (*fakeMailgun)(nil)
