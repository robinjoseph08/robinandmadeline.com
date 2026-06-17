package settings_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/settings"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAPI wires the settings routes onto a bare Echo group with the shared error
// handler AND the custom binder (no auth middleware: these tests exercise the
// handlers, the validation pipeline, and the response shapes; auth enforcement
// is covered by the server package). It uses the package's own isolated
// Postgres test database (NewIsolated): these tests truncate app_settings,
// which pkg/rsvps also truncates in the shared database, and go test runs the
// two binaries in parallel. app_settings is truncated so each test starts
// clean.
func newAPI(t *testing.T) *echo.Echo {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_settings_test")
	databasetest.Truncate(t, db, "app_settings")
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	settings.RegisterRoutes(e.Group("/api/admin"), settings.NewService(db))
	return e
}

// do issues a JSON request against the settings handler and returns the
// recorder. Every settings route lives at /api/admin/settings, so the path is
// fixed; only the method and body vary.
func do(t *testing.T, e *echo.Echo, method string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, "/api/admin/settings", reader)
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

func TestGetSettings_EmptyReturnsNullFields(t *testing.T) {
	// With nothing configured, both settings come back null (the unset state),
	// not an error: an absent app_settings row is valid.
	e := newAPI(t)

	rec := do(t, e, http.MethodGet, nil)
	require.Equal(t, http.StatusOK, rec.Code)
	var resp settings.Response
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Nil(t, resp.RSVPDeadline)
	assert.Nil(t, resp.ContactEmail)
}

func TestUpdateSettings_RoundTrip(t *testing.T) {
	// A PUT writes the settings and returns the refreshed state; a follow-up GET
	// reflects the same values (proving they persisted, not just echoed).
	e := newAPI(t)

	rec := do(t, e, http.MethodPut, map[string]any{
		"rsvp_deadline": "2026-08-01T23:59:59Z",
		"contact_email": "hello@example.com",
	})
	require.Equal(t, http.StatusOK, rec.Code)
	var updated settings.Response
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &updated))
	require.NotNil(t, updated.RSVPDeadline)
	require.NotNil(t, updated.ContactEmail)
	assert.Equal(t, "2026-08-01T23:59:59Z", *updated.RSVPDeadline)
	assert.Equal(t, "hello@example.com", *updated.ContactEmail)

	rec = do(t, e, http.MethodGet, nil)
	require.Equal(t, http.StatusOK, rec.Code)
	var got settings.Response
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	require.NotNil(t, got.RSVPDeadline)
	require.NotNil(t, got.ContactEmail)
	assert.Equal(t, "2026-08-01T23:59:59Z", *got.RSVPDeadline)
	assert.Equal(t, "hello@example.com", *got.ContactEmail)
}

func TestUpdateSettings_PartialLeavesOthersUntouched(t *testing.T) {
	// Setting only one field must not disturb the other: an absent field is
	// left as-is, so the settings page can save one field without resending the
	// rest.
	e := newAPI(t)

	// Seed both.
	rec := do(t, e, http.MethodPut, map[string]any{
		"rsvp_deadline": "2026-08-01T23:59:59Z",
		"contact_email": "hello@example.com",
	})
	require.Equal(t, http.StatusOK, rec.Code)

	// Update only the contact email; the deadline must survive.
	rec = do(t, e, http.MethodPut, map[string]any{
		"contact_email": "new@example.com",
	})
	require.Equal(t, http.StatusOK, rec.Code)
	var resp settings.Response
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.NotNil(t, resp.RSVPDeadline)
	assert.Equal(t, "2026-08-01T23:59:59Z", *resp.RSVPDeadline)
	require.NotNil(t, resp.ContactEmail)
	assert.Equal(t, "new@example.com", *resp.ContactEmail)
}

func TestUpdateSettings_BlankClearsSetting(t *testing.T) {
	// A present-but-blank value is the "clear this setting" gesture: it deletes
	// the row, returning the setting to its unset (null) state.
	e := newAPI(t)

	rec := do(t, e, http.MethodPut, map[string]any{
		"rsvp_deadline": "2026-08-01T23:59:59Z",
		"contact_email": "hello@example.com",
	})
	require.Equal(t, http.StatusOK, rec.Code)

	rec = do(t, e, http.MethodPut, map[string]any{
		"rsvp_deadline": "",
	})
	require.Equal(t, http.StatusOK, rec.Code)
	var resp settings.Response
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Nil(t, resp.RSVPDeadline)
	// The untouched contact email survives the clear of the deadline.
	require.NotNil(t, resp.ContactEmail)
	assert.Equal(t, "hello@example.com", *resp.ContactEmail)
}

func TestUpdateSettings_MalformedDeadlineIs422(t *testing.T) {
	// A bad rsvp_deadline timestamp is a validation error (422), not a 500: the
	// binder rejects it before it can reach the parse in the readers.
	e := newAPI(t)

	rec := do(t, e, http.MethodPut, map[string]any{
		"rsvp_deadline": "not-a-timestamp",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestUpdateSettings_MalformedEmailIs422(t *testing.T) {
	// A malformed contact_email is a validation error (422), not a 500.
	e := newAPI(t)

	rec := do(t, e, http.MethodPut, map[string]any{
		"contact_email": "not-an-email",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestUpdateSettings_TrimsValues(t *testing.T) {
	// The binder trims the values, so a stored deadline parses cleanly later
	// (the RSVP reader does a strict time.Parse) and a contact email has no
	// stray whitespace.
	e := newAPI(t)

	rec := do(t, e, http.MethodPut, map[string]any{
		"rsvp_deadline": "  2026-08-01T23:59:59Z  ",
		"contact_email": "  hello@example.com  ",
	})
	require.Equal(t, http.StatusOK, rec.Code)
	var resp settings.Response
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.NotNil(t, resp.RSVPDeadline)
	assert.Equal(t, "2026-08-01T23:59:59Z", *resp.RSVPDeadline)
	require.NotNil(t, resp.ContactEmail)
	assert.Equal(t, "hello@example.com", *resp.ContactEmail)
}
