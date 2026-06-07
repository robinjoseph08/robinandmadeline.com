package parties_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAPI wires the parties routes onto a bare Echo group with the shared error
// handler AND the custom binder (no auth middleware: these tests exercise the
// handlers, validation pipeline, and response shapes, while auth enforcement is
// covered by the server package). Wiring the real binder means requests flow
// through the same bind -> mod -> default -> validate pipeline as production, so
// invalid input is rejected here exactly as it would be live. It shares the
// Postgres test DB.
func newAPI(t *testing.T) *echo.Echo {
	t.Helper()
	svc, _ := newService(t)
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler(slogDiscard()).Handle
	g := e.Group("/api/admin")
	parties.RegisterRoutes(g, svc)
	return e
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

// rawPost issues a POST with a verbatim JSON body string, for cases the typed
// map helper cannot express (an unknown field, malformed JSON).
func rawPost(t *testing.T, e *echo.Echo, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, target, bytes.NewReader([]byte(body)))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestCreatePartyHandler_ReturnsStatusAndToken(t *testing.T) {
	e := newAPI(t)

	rec := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "The Smiths", "side": "robin", "relation": "friend",
		"invitation_type": "digital", "circle": []string{"College"},
	})
	require.Equal(t, http.StatusCreated, rec.Code)

	var resp struct {
		ID                   string `json:"id"`
		InfoToken            string `json:"info_token"`
		InfoCollectionStatus string `json:"info_collection_status"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.NotEmpty(t, resp.ID)
	assert.NotEmpty(t, resp.InfoToken, "response should include the generated info token")
	// No primary email yet, so a fresh digital party derives incomplete.
	assert.Equal(t, models.StatusIncomplete, resp.InfoCollectionStatus)
}

func TestCreatePartyHandler_InvalidEnumIs422(t *testing.T) {
	e := newAPI(t)
	rec := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "X", "side": "nobody", "relation": "friend", "invitation_type": "digital",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

// The following tests drive the custom binder end to end: each asserts that the
// pipeline rejects bad input at the handler boundary with the right errcode,
// proving validation is fully tag-driven (no service-level checks remain).

func TestCreatePartyHandler_MissingRequiredNameIs422(t *testing.T) {
	e := newAPI(t)
	// name omitted: the required tag rejects it as a 422 validation_error.
	rec := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"side": "robin", "relation": "friend", "invitation_type": "digital",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestCreatePartyHandler_BlankNameAfterTrimIs422(t *testing.T) {
	e := newAPI(t)
	// A whitespace-only name is trimmed to "" by mod:"trim", then rejected by the
	// required tag: present-but-blank is a 422, not a silent empty insert.
	rec := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "   ", "side": "robin", "relation": "friend", "invitation_type": "digital",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestCreatePartyHandler_EmptyRSVPCodeIs422(t *testing.T) {
	e := newAPI(t)
	// An explicit empty rsvp_code is invalid (min=1 after trim): "no code" must be
	// sent as null, not "". This keeps blank codes out of the unique index.
	rec := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "X", "side": "robin", "relation": "friend",
		"invitation_type": "digital", "rsvp_code": "   ",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestCreatePartyHandler_InvalidCircleValueIs422(t *testing.T) {
	e := newAPI(t)
	// circle is a closed set; an unknown element fails dive,oneof as a 422.
	rec := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "X", "side": "robin", "relation": "friend",
		"invitation_type": "digital", "circle": []string{"NotACircle"},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestCreatePartyHandler_UnknownFieldIs422(t *testing.T) {
	e := newAPI(t)
	// An unrecognized JSON field is rejected as unknown_parameter (the binder
	// decodes with DisallowUnknownFields).
	rec := rawPost(t, e, "/api/admin/parties", `{"name":"X","side":"robin","relation":"friend","invitation_type":"digital","bogus":1}`)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeUnknownParameter), errorCode(t, rec))
}

func TestCreatePartyHandler_EmptyBodyIs400(t *testing.T) {
	e := newAPI(t)
	// A bodyless POST is rejected as empty_request_body (a 400) by the binder.
	rec := do(t, e, http.MethodPost, "/api/admin/parties", nil)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Equal(t, string(errcodes.CodeEmptyRequestBody), errorCode(t, rec))
}

func TestCreateGuestHandler_InvalidEmailIs422(t *testing.T) {
	e := newAPI(t)
	create := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "Fam", "side": "robin", "relation": "family", "invitation_type": "digital",
	})
	require.Equal(t, http.StatusCreated, create.Code)
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))

	// A malformed email fails the email tag as a 422.
	rec := do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests",
		map[string]any{"full_name": "Pat", "email": "not-an-email"})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestListPartiesHandler_InvalidFilterValueIs422(t *testing.T) {
	e := newAPI(t)
	// Query filters are validated too: a bad side value is a 422 from the binder's
	// query path (gorilla/schema decode + validator).
	rec := do(t, e, http.MethodGet, "/api/admin/parties?side=nobody", nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestListPartiesHandler_FilterByQueryParam(t *testing.T) {
	e := newAPI(t)
	// Create a robin party and a madeline party, then filter to robin via the
	// query string, proving list filters now flow through c.Bind.
	require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "R", "side": "robin", "relation": "friend", "invitation_type": "digital",
	}).Code)
	require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "M", "side": "madeline", "relation": "family", "invitation_type": "digital",
	}).Code)

	rec := do(t, e, http.MethodGet, "/api/admin/parties?side=robin", nil)
	require.Equal(t, http.StatusOK, rec.Code)
	var resp struct {
		Items []struct {
			Name string `json:"name"`
		} `json:"items"`
		Total int `json:"total"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Equal(t, 1, resp.Total)
	require.Len(t, resp.Items, 1)
	assert.Equal(t, "R", resp.Items[0].Name)
}

func TestCreatePartyHandler_OmittedCirclePersistsAsEmptyArray(t *testing.T) {
	e := newAPI(t)
	// Omitting circle entirely must persist (and read back) as an empty array, not
	// null: default:"[]" initializes it before validate, and the model hook is the
	// backstop. The same applies to guest roles below.
	create := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "NoCircle", "side": "robin", "relation": "friend", "invitation_type": "digital",
	})
	require.Equal(t, http.StatusCreated, create.Code)
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))

	get := do(t, e, http.MethodGet, "/api/admin/parties/"+party.ID, nil)
	require.Equal(t, http.StatusOK, get.Code)
	// The raw JSON must contain "circle":[] (a present empty array), never null.
	assert.Contains(t, get.Body.String(), `"circle":[]`)

	// And a guest with no roles persists roles as [].
	addRec := do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests",
		map[string]any{"full_name": "No Roles"})
	require.Equal(t, http.StatusCreated, addRec.Code)
	assert.Contains(t, addRec.Body.String(), `"roles":[]`)
}

func TestCreatePartyHandler_DuplicateRSVPCodeIs409(t *testing.T) {
	e := newAPI(t)
	body := map[string]any{
		"name": "X", "side": "robin", "relation": "friend",
		"invitation_type": "digital", "rsvp_code": "KALEL",
	}
	require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties", body).Code)
	assert.Equal(t, http.StatusConflict, do(t, e, http.MethodPost, "/api/admin/parties", body).Code)
}

func TestGetPartyHandler_404(t *testing.T) {
	e := newAPI(t)
	rec := do(t, e, http.MethodGet, "/api/admin/parties/00000000-0000-0000-0000-000000000000", nil)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}

func TestMarkInfoHandler_CompleteWithMissingFieldsIs422(t *testing.T) {
	e := newAPI(t)

	// Physical party, no address, no primary email: not markable complete.
	create := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "Y", "side": "madeline", "relation": "family", "invitation_type": "physical",
	})
	require.Equal(t, http.StatusCreated, create.Code)
	var p struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &p))

	rec := do(t, e, http.MethodPost, "/api/admin/parties/"+p.ID+"/mark-info", map[string]any{"status": "complete"})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestMarkInfoHandler_InvalidStatusIs422(t *testing.T) {
	e := newAPI(t)
	create := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "Z", "side": "robin", "relation": "friend", "invitation_type": "digital",
	})
	var p struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &p))

	// The binder constrains status to complete|incomplete, so a bad value is a
	// 422 validation_error (not a 400) before the handler runs.
	rec := do(t, e, http.MethodPost, "/api/admin/parties/"+p.ID+"/mark-info", map[string]any{"status": "bogus"})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestCreateGuestHandler_UnderMissingPartyIs404(t *testing.T) {
	e := newAPI(t)
	rec := do(t, e, http.MethodPost, "/api/admin/parties/00000000-0000-0000-0000-000000000000/guests",
		map[string]any{"full_name": "Ghost"})
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestListHandlers_EmptyReturnsItemsArrayNotNull(t *testing.T) {
	e := newAPI(t)

	// With no rows, both list endpoints must return the {items, total} envelope
	// with items serialized as [] (a JSON array), never null, and total 0.
	for _, target := range []string{"/api/admin/parties", "/api/admin/guests"} {
		rec := do(t, e, http.MethodGet, target, nil)
		require.Equal(t, http.StatusOK, rec.Code, target)
		assert.JSONEq(t, `{"items":[],"total":0}`, rec.Body.String(), target)
	}
}

func TestListPartiesHandler_EnvelopeCarriesItemsAndTotal(t *testing.T) {
	e := newAPI(t)

	// Create a party with a primary guest so the list item carries its status.
	create := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "Fam", "side": "robin", "relation": "family", "invitation_type": "digital",
	})
	require.Equal(t, http.StatusCreated, create.Code)
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))
	require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests",
		map[string]any{"full_name": "Pat", "email": "pat@example.com", "is_primary": true}).Code)

	rec := do(t, e, http.MethodGet, "/api/admin/parties", nil)
	require.Equal(t, http.StatusOK, rec.Code)
	var resp struct {
		Items []struct {
			ID                   string `json:"id"`
			InfoCollectionStatus string `json:"info_collection_status"`
		} `json:"items"`
		Total int `json:"total"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Equal(t, 1, resp.Total)
	require.Len(t, resp.Items, 1)
	assert.Equal(t, party.ID, resp.Items[0].ID)
	// Digital party with a primary email derives complete, and the list item
	// carries info_collection_status.
	assert.Equal(t, models.StatusComplete, resp.Items[0].InfoCollectionStatus)
}

func TestGuestLifecycleHandlers(t *testing.T) {
	e := newAPI(t)

	// Create a party, add a guest under it, then list/update/delete via HTTP.
	create := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "Fam", "side": "robin", "relation": "family", "invitation_type": "digital",
	})
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))

	addRec := do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests",
		map[string]any{"full_name": "Pat", "email": "pat@example.com", "is_primary": true})
	require.Equal(t, http.StatusCreated, addRec.Code)
	var guest struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(addRec.Body.Bytes(), &guest))

	// Flat guest list returns the {items, total} envelope holding the guest.
	listRec := do(t, e, http.MethodGet, "/api/admin/guests", nil)
	require.Equal(t, http.StatusOK, listRec.Code)
	var listed struct {
		Items []struct {
			ID string `json:"id"`
		} `json:"items"`
		Total int `json:"total"`
	}
	require.NoError(t, json.Unmarshal(listRec.Body.Bytes(), &listed))
	require.Equal(t, 1, listed.Total)
	require.Len(t, listed.Items, 1)
	assert.Equal(t, guest.ID, listed.Items[0].ID)

	// PATCH the guest.
	patchRec := do(t, e, http.MethodPatch, "/api/admin/guests/"+guest.ID,
		map[string]any{"full_name": "Patricia", "is_primary": true})
	assert.Equal(t, http.StatusOK, patchRec.Code)

	// DELETE the guest.
	delRec := do(t, e, http.MethodDelete, "/api/admin/guests/"+guest.ID, nil)
	assert.Equal(t, http.StatusNoContent, delRec.Code)
}

// errorCode decodes the standard error envelope and returns its code.
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
