package parties_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAPI wires the parties routes onto a bare Echo group (no auth middleware:
// these tests exercise the handlers and status mapping, while auth enforcement
// is covered by the server package). It shares the Postgres test DB.
func newAPI(t *testing.T) *echo.Echo {
	t.Helper()
	svc, _ := newService(t)
	e := echo.New()
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
	assert.Equal(t, parties.StatusIncomplete, resp.InfoCollectionStatus)
}

func TestCreatePartyHandler_InvalidEnumIs400(t *testing.T) {
	e := newAPI(t)
	rec := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "X", "side": "nobody", "relation": "friend", "invitation_type": "digital",
	})
	assert.Equal(t, http.StatusBadRequest, rec.Code)
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

func TestMarkInfoHandler_InvalidStatusIs400(t *testing.T) {
	e := newAPI(t)
	create := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "Z", "side": "robin", "relation": "friend", "invitation_type": "digital",
	})
	var p struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &p))

	rec := do(t, e, http.MethodPost, "/api/admin/parties/"+p.ID+"/mark-info", map[string]any{"status": "bogus"})
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestCreateGuestHandler_UnderMissingPartyIs404(t *testing.T) {
	e := newAPI(t)
	rec := do(t, e, http.MethodPost, "/api/admin/parties/00000000-0000-0000-0000-000000000000/guests",
		map[string]any{"full_name": "Ghost"})
	assert.Equal(t, http.StatusNotFound, rec.Code)
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

	// Flat guest list returns the guest.
	listRec := do(t, e, http.MethodGet, "/api/admin/guests", nil)
	require.Equal(t, http.StatusOK, listRec.Code)
	var listed []struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(listRec.Body.Bytes(), &listed))
	require.Len(t, listed, 1)
	assert.Equal(t, guest.ID, listed[0].ID)

	// PATCH the guest.
	patchRec := do(t, e, http.MethodPatch, "/api/admin/guests/"+guest.ID,
		map[string]any{"full_name": "Patricia", "is_primary": true})
	assert.Equal(t, http.StatusOK, patchRec.Code)

	// DELETE the guest.
	delRec := do(t, e, http.MethodDelete, "/api/admin/guests/"+guest.ID, nil)
	assert.Equal(t, http.StatusNoContent, delRec.Code)
}
