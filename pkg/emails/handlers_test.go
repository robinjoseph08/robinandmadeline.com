package emails_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAPI wires the emails routes onto a bare Echo group with the shared error
// handler AND the custom binder (no auth middleware: these tests exercise the
// handlers, validation pipeline, and response shapes, while auth enforcement
// is covered by the server package). It uses the package's isolated Postgres
// test database; the returned fixtures build test data.
func newAPI(t *testing.T) (*echo.Echo, fixtures) {
	t.Helper()
	f := newFixtures(t)
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	g := e.Group("/api/admin")
	emails.RegisterRoutes(g, f.emails)
	return e, f
}

// do issues a JSON request against the handler and returns the recorder.
func do(t *testing.T, e *echo.Echo, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, target, reader)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// errorCode extracts the error envelope's code from a response.
func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return body.Error.Code
}

func TestTemplateHandlers_CRUDRoundTrip(t *testing.T) {
	e, _ := newAPI(t)

	// Create.
	rec := do(t, e, http.MethodPost, "/api/admin/emails/templates", map[string]any{
		"name": "Save the date", "subject": "Hi {{guest_name}}", "body": "Body",
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var created emails.TemplateResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))
	assert.NotEmpty(t, created.ID)

	// List.
	rec = do(t, e, http.MethodGet, "/api/admin/emails/templates", nil)
	require.Equal(t, http.StatusOK, rec.Code)
	var list emails.ListTemplatesResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &list))
	assert.Equal(t, 1, list.Total)

	// Update.
	rec = do(t, e, http.MethodPut, "/api/admin/emails/templates/"+created.ID, map[string]any{
		"name": "Updated", "subject": "New", "body": "New body",
	})
	require.Equal(t, http.StatusOK, rec.Code)

	// Get reflects the update.
	rec = do(t, e, http.MethodGet, "/api/admin/emails/templates/"+created.ID, nil)
	require.Equal(t, http.StatusOK, rec.Code)
	var got emails.TemplateResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	assert.Equal(t, "Updated", got.Name)

	// Delete, then the get 404s.
	rec = do(t, e, http.MethodDelete, "/api/admin/emails/templates/"+created.ID, nil)
	require.Equal(t, http.StatusNoContent, rec.Code)
	rec = do(t, e, http.MethodGet, "/api/admin/emails/templates/"+created.ID, nil)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestCreateTemplateHandler_MissingFieldsIs422(t *testing.T) {
	e, _ := newAPI(t)
	rec := do(t, e, http.MethodPost, "/api/admin/emails/templates", map[string]any{
		"name": "No body or subject",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestTemplateHandlers_MalformedIDIs404(t *testing.T) {
	e, _ := newAPI(t)
	rec := do(t, e, http.MethodGet, "/api/admin/emails/templates/not-a-uuid", nil)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}

func TestPreviewHandler_ReturnsSampleAndRecipients(t *testing.T) {
	e, f := newAPI(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	rec := do(t, e, http.MethodPost, "/api/admin/emails/preview", map[string]any{
		"subject": "Hi {{guest_name}}",
		"body":    "From {{party_name}}",
		"filter":  map[string]any{"side": "robin"},
	})
	require.Equal(t, http.StatusOK, rec.Code)
	var resp emails.PreviewEmailResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, 1, resp.Total)
	assert.Equal(t, "Hi Alice", resp.SampleSubject)
	assert.Equal(t, "From The Smiths", resp.SampleBody)
}

func TestPreviewHandler_InvalidFilterValueIs422(t *testing.T) {
	e, _ := newAPI(t)
	rec := do(t, e, http.MethodPost, "/api/admin/emails/preview", map[string]any{
		"subject": "s", "body": "b",
		"filter": map[string]any{"side": "neither"},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestSendHandler_Returns201WithQueuedStats(t *testing.T) {
	e, f := newAPI(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	rec := do(t, e, http.MethodPost, "/api/admin/emails/send", map[string]any{
		"subject": "Hi {{guest_name}}", "body": "Save the date!",
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var resp emails.SendResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.NotEmpty(t, resp.ID)
	// The send returns immediately with every recipient still queued: the
	// worker dispatches asynchronously.
	assert.Equal(t, emails.SendStats{Queued: 2, Total: 2}, resp.Stats)
}

func TestSendHandler_NoRecipientsIs422(t *testing.T) {
	e, _ := newAPI(t)
	rec := do(t, e, http.MethodPost, "/api/admin/emails/send", map[string]any{
		"subject": "s", "body": "b",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestSendHistoryHandlers_ListAndDetail(t *testing.T) {
	e, f := newAPI(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	rec := do(t, e, http.MethodPost, "/api/admin/emails/send", map[string]any{
		"subject": "Hello", "body": "World",
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var sent emails.SendResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &sent))

	rec = do(t, e, http.MethodGet, "/api/admin/emails/sends", nil)
	require.Equal(t, http.StatusOK, rec.Code)
	var list emails.ListSendsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &list))
	require.Equal(t, 1, list.Total)
	assert.Equal(t, sent.ID, list.Items[0].ID)
	assert.Equal(t, emails.SendStats{Queued: 1, Total: 1}, list.Items[0].Stats)

	rec = do(t, e, http.MethodGet, "/api/admin/emails/sends/"+sent.ID, nil)
	require.Equal(t, http.StatusOK, rec.Code)
	var detail emails.SendDetailResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &detail))
	require.Len(t, detail.Recipients, 1)
	assert.Equal(t, "Alice", detail.Recipients[0].GuestName)
	assert.Equal(t, "The Smiths", detail.Recipients[0].PartyName)
	assert.Equal(t, "alice@example.com", detail.Recipients[0].EmailAddress)
	assert.Equal(t, "queued", detail.Recipients[0].Status)
	// The detail carries the same stats tally the list does; the header
	// summary renders from it.
	assert.Equal(t, emails.SendStats{Queued: 1, Total: 1}, detail.Stats)
}

func TestGetSendHandler_MissingIs404(t *testing.T) {
	e, _ := newAPI(t)
	rec := do(t, e, http.MethodGet, "/api/admin/emails/sends/00000000-0000-0000-0000-000000000000", nil)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}
