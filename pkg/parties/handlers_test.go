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
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
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

// withGuest attaches a default first guest to a party-create body when one is
// not already present, so a test focused on the party fields still satisfies the
// create-with-guest contract (POST /parties is born with its primary guest).
func withGuest(party map[string]any) map[string]any {
	if _, ok := party["guest"]; !ok {
		party["guest"] = map[string]any{"full_name": "First Guest"}
	}
	return party
}

func TestCreatePartyHandler_ReturnsStatusAndToken(t *testing.T) {
	e := newAPI(t)

	rec := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "The Smiths", "side": "robin", "relation": "friend",
		"invitation_type": "digital", "circle": []string{"College"},
	}))
	require.Equal(t, http.StatusCreated, rec.Code)

	var resp struct {
		ID                   string  `json:"id"`
		InfoToken            string  `json:"info_token"`
		RSVPCode             *string `json:"rsvp_code"`
		InfoCollectionStatus string  `json:"info_collection_status"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.NotEmpty(t, resp.ID)
	assert.NotEmpty(t, resp.InfoToken, "response should include the generated info token")
	// No code in the request, so the response carries a generated one.
	require.NotNil(t, resp.RSVPCode, "response should include the generated rsvp_code")
	assert.Regexp(t, rsvpCodePattern, *resp.RSVPCode)
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
	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "Fam", "side": "robin", "relation": "family", "invitation_type": "digital",
	}))
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
	require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "R", "side": "robin", "relation": "friend", "invitation_type": "digital",
	})).Code)
	require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "M", "side": "madeline", "relation": "family", "invitation_type": "digital",
	})).Code)

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

func TestListPartiesHandler_InvalidSortValueIs422(t *testing.T) {
	e := newAPI(t)
	// The sort spec is validated by the binder's sortspec validator, like a bad
	// filter enum: an unknown field is a 422 before the handler runs.
	rec := do(t, e, http.MethodGet, "/api/admin/parties?sort=bogus:asc", nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestListGuestsHandler_SortFieldIsScopedToEntity(t *testing.T) {
	e := newAPI(t)
	// "invitation" is a party-only sort field; the guest list's sortspec=guests
	// whitelist rejects it, proving the validator is scoped per entity.
	rec := do(t, e, http.MethodGet, "/api/admin/guests?sort=invitation:asc", nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestListPartiesHandler_SortByQueryParam(t *testing.T) {
	e := newAPI(t)
	// Create three parties whose names and sides order differently, then sort via
	// the query string, proving the multi-level spec flows through c.Bind into the
	// order by. Bob is robin; alice and Charlie are madeline.
	for _, p := range []map[string]any{
		{"name": "Bob", "side": "robin"},
		{"name": "alice", "side": "madeline"},
		{"name": "Charlie", "side": "madeline"},
	} {
		p["relation"] = "friend"
		p["invitation_type"] = "digital"
		require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties", withGuest(p)).Code)
	}

	names := func(target string) []string {
		rec := do(t, e, http.MethodGet, target, nil)
		require.Equal(t, http.StatusOK, rec.Code)
		var resp struct {
			Items []struct {
				Name string `json:"name"`
			} `json:"items"`
		}
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
		got := make([]string, len(resp.Items))
		for i, it := range resp.Items {
			got[i] = it.Name
		}
		return got
	}

	assert.Equal(t, []string{"alice", "Bob", "Charlie"}, names("/api/admin/parties?sort=name:asc"))
	// Multi-level: side asc (madeline first) then name asc within each side.
	assert.Equal(t, []string{"alice", "Charlie", "Bob"}, names("/api/admin/parties?sort=side:asc,name:asc"))
}

func TestListGuestsHandler_MultiTagQueryParamFiltersAnyOf(t *testing.T) {
	e := newAPI(t)
	// One party with two guests carrying different tags, added through the
	// nested guest endpoint so the tags persist on real rows.
	createRec := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "P", "side": "robin", "relation": "friend", "invitation_type": "digital",
	}))
	require.Equal(t, http.StatusCreated, createRec.Code)
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(createRec.Body.Bytes(), &party))

	require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests",
		map[string]any{"full_name": "Alice", "tags": []string{"Bridal Party"}}).Code)
	require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests",
		map[string]any{"full_name": "Bob", "tags": []string{"Cousin"}}).Code)
	require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests",
		map[string]any{"full_name": "Carol", "tags": []string{"UIUC"}}).Code)

	// Repeated ?tags=a&tags=b binds to the slice and matches a guest with ANY
	// of them (array overlap).
	rec := do(t, e, http.MethodGet, "/api/admin/guests?tags=Bridal+Party&tags=Cousin", nil)
	require.Equal(t, http.StatusOK, rec.Code)
	var resp struct {
		Items []struct {
			FullName string `json:"full_name"`
		} `json:"items"`
		Total int `json:"total"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	got := make([]string, 0, len(resp.Items))
	for _, it := range resp.Items {
		got = append(got, it.FullName)
	}
	assert.ElementsMatch(t, []string{"Alice", "Bob"}, got)
}

func TestCreatePartyHandler_OmittedCirclePersistsAsEmptyArray(t *testing.T) {
	e := newAPI(t)
	// Omitting circle entirely must persist (and read back) as an empty array, not
	// null: default:"[]" initializes it before validate, and the model hook is the
	// backstop. The same applies to guest tags below.
	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "NoCircle", "side": "robin", "relation": "friend", "invitation_type": "digital",
	}))
	require.Equal(t, http.StatusCreated, create.Code)
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))

	get := do(t, e, http.MethodGet, "/api/admin/parties/"+party.ID, nil)
	require.Equal(t, http.StatusOK, get.Code)
	// The raw JSON must contain "circle":[] (a present empty array), never null.
	assert.Contains(t, get.Body.String(), `"circle":[]`)

	// And a guest with no tags persists tags as [].
	addRec := do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests",
		map[string]any{"full_name": "No Tags"})
	require.Equal(t, http.StatusCreated, addRec.Code)
	assert.Contains(t, addRec.Body.String(), `"tags":[]`)
}

func TestCreatePartyHandler_DuplicateRSVPCodeIs409(t *testing.T) {
	e := newAPI(t)
	body := withGuest(map[string]any{
		"name": "X", "side": "robin", "relation": "friend",
		"invitation_type": "digital", "rsvp_code": "KALEL",
	})
	require.Equal(t, http.StatusCreated, do(t, e, http.MethodPost, "/api/admin/parties", body).Code)
	assert.Equal(t, http.StatusConflict, do(t, e, http.MethodPost, "/api/admin/parties", body).Code)
}

func TestCreatePartyHandler_DefaultsInvitationAndUppercasesRSVP(t *testing.T) {
	e := newAPI(t)

	// invitation_type omitted defaults to physical (the common case); rsvp_code is
	// upper-cased on the way in, since codes are always shown in all caps.
	rec := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "Defaults", "side": "robin", "relation": "friend",
		"rsvp_code": "kal-el",
		"guest":     map[string]any{"full_name": "Pat"},
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	var resp struct {
		InvitationType string `json:"invitation_type"`
		RSVPCode       string `json:"rsvp_code"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, "physical", resp.InvitationType, "omitted invitation_type defaults to physical")
	assert.Equal(t, "KAL-EL", resp.RSVPCode, "rsvp_code is stored upper-cased")
}

func TestPatchPartyHandler_UppercasesRSVPCode(t *testing.T) {
	e := newAPI(t)
	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "Up", "side": "robin", "relation": "friend", "invitation_type": "digital",
	}))
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))

	rec := do(t, e, http.MethodPatch, "/api/admin/parties/"+party.ID, map[string]any{"rsvp_code": "abc123"})
	require.Equal(t, http.StatusOK, rec.Code)
	var got struct {
		RSVPCode string `json:"rsvp_code"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &got))
	assert.Equal(t, "ABC123", got.RSVPCode, "a patched rsvp_code is upper-cased")
}

func TestGetPartyHandler_404(t *testing.T) {
	e := newAPI(t)
	rec := do(t, e, http.MethodGet, "/api/admin/parties/00000000-0000-0000-0000-000000000000", nil)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}

func TestGetPartyHandler_MalformedIDIs404(t *testing.T) {
	e := newAPI(t)
	// A non-UUID path id can never name a row, so it gets the same 404 as a
	// missing party rather than a 500 from a failed text-to-uuid cast.
	rec := do(t, e, http.MethodGet, "/api/admin/parties/abc", nil)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}

func TestPatchGuestHandler_MalformedIDIs404(t *testing.T) {
	e := newAPI(t)
	// Same contract on the guest routes: a malformed guest id is a 404.
	rec := do(t, e, http.MethodPatch, "/api/admin/guests/abc", map[string]any{"full_name": "X"})
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}

func TestMarkInfoHandler_CompleteWithMissingFieldsIs422(t *testing.T) {
	e := newAPI(t)

	// Physical party, no address, no primary email: not markable complete.
	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "Y", "side": "madeline", "relation": "family", "invitation_type": "physical",
	}))
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
	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "Z", "side": "robin", "relation": "friend", "invitation_type": "digital",
	}))
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
	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "Fam", "side": "robin", "relation": "family", "invitation_type": "digital",
	}))
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

	// A party is born with its first (primary) guest; list/patch/delete it via HTTP.
	create := do(t, e, http.MethodPost, "/api/admin/parties", map[string]any{
		"name": "Fam", "side": "robin", "relation": "family", "invitation_type": "digital",
		"guest": map[string]any{"full_name": "Pat", "email": "pat@example.com"},
	})
	require.Equal(t, http.StatusCreated, create.Code)
	var party struct {
		ID     string `json:"id"`
		Guests []struct {
			ID string `json:"id"`
		} `json:"guests"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))
	require.Len(t, party.Guests, 1)
	guestID := party.Guests[0].ID

	// Flat guest list returns the {items, total} envelope holding the guest, and
	// each item carries the owning party's name (and id) so the UI can link back
	// to and edit the guest in its party's context.
	listRec := do(t, e, http.MethodGet, "/api/admin/guests", nil)
	require.Equal(t, http.StatusOK, listRec.Code)
	var listed struct {
		Items []struct {
			ID        string `json:"id"`
			PartyID   string `json:"party_id"`
			PartyName string `json:"party_name"`
		} `json:"items"`
		Total int `json:"total"`
	}
	require.NoError(t, json.Unmarshal(listRec.Body.Bytes(), &listed))
	require.Equal(t, 1, listed.Total)
	require.Len(t, listed.Items, 1)
	assert.Equal(t, guestID, listed.Items[0].ID)
	assert.Equal(t, party.ID, listed.Items[0].PartyID)
	assert.Equal(t, "Fam", listed.Items[0].PartyName, "flat list item carries the owning party's name")

	// PATCH the guest.
	patchRec := do(t, e, http.MethodPatch, "/api/admin/guests/"+guestID,
		map[string]any{"full_name": "Patricia"})
	assert.Equal(t, http.StatusOK, patchRec.Code)

	// DELETE the guest (its party's last, so the party goes too).
	delRec := do(t, e, http.MethodDelete, "/api/admin/guests/"+guestID, nil)
	assert.Equal(t, http.StatusNoContent, delRec.Code)
}

func TestPatchPartyHandler_TouchesOnlySentField(t *testing.T) {
	e := newAPI(t)

	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "Fam", "side": "robin", "relation": "family", "invitation_type": "digital",
	}))
	require.Equal(t, http.StatusCreated, create.Code)
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))

	// PATCH only invitation_type; everything else must be left as-is.
	patch := do(t, e, http.MethodPatch, "/api/admin/parties/"+party.ID, map[string]any{
		"invitation_type": "physical",
	})
	require.Equal(t, http.StatusOK, patch.Code)

	get := do(t, e, http.MethodGet, "/api/admin/parties/"+party.ID, nil)
	require.Equal(t, http.StatusOK, get.Code)
	var got struct {
		Name           string `json:"name"`
		Side           string `json:"side"`
		InvitationType string `json:"invitation_type"`
	}
	require.NoError(t, json.Unmarshal(get.Body.Bytes(), &got))
	assert.Equal(t, "Fam", got.Name, "name must be unchanged")
	assert.Equal(t, "robin", got.Side, "side must be unchanged")
	assert.Equal(t, "physical", got.InvitationType, "only invitation_type should change")
}

func TestPatchPartyHandler_BlankNameIs422(t *testing.T) {
	e := newAPI(t)
	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "Keep", "side": "robin", "relation": "friend", "invitation_type": "digital",
	}))
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))

	// A present-but-blank name is a 422: min=1 fires because a non-nil pointer is
	// "present" even when it points at the empty string. A whitespace-only name is
	// trimmed first, then rejected the same way.
	for _, name := range []string{"", "   "} {
		rec := do(t, e, http.MethodPatch, "/api/admin/parties/"+party.ID, map[string]any{"name": name})
		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, "name=%q", name)
		assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec), "name=%q", name)
	}
}

func TestPatchGuestHandler_PartialUpdateAndEmailClear(t *testing.T) {
	e := newAPI(t)
	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "Fam", "side": "robin", "relation": "family", "invitation_type": "digital",
	}))
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))
	add := do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests",
		map[string]any{"full_name": "Pat", "email": "pat@example.com", "is_child": false})
	require.Equal(t, http.StatusCreated, add.Code)
	var guest struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(add.Body.Bytes(), &guest))

	// PATCH only is_child: email must survive (the partial does not clobber it).
	flag := do(t, e, http.MethodPatch, "/api/admin/guests/"+guest.ID, map[string]any{"is_child": true})
	require.Equal(t, http.StatusOK, flag.Code)
	var afterFlag struct {
		Email   *string `json:"email"`
		IsChild bool    `json:"is_child"`
	}
	require.NoError(t, json.Unmarshal(flag.Body.Bytes(), &afterFlag))
	assert.True(t, afterFlag.IsChild)
	require.NotNil(t, afterFlag.Email, "email must survive a flag-only patch")
	assert.Equal(t, "pat@example.com", *afterFlag.Email)

	// A blank email clears it (emailblank permits blank; the service stores null).
	clearRec := do(t, e, http.MethodPatch, "/api/admin/guests/"+guest.ID, map[string]any{"email": ""})
	require.Equal(t, http.StatusOK, clearRec.Code)
	var afterClear struct {
		Email *string `json:"email"`
	}
	require.NoError(t, json.Unmarshal(clearRec.Body.Bytes(), &afterClear))
	assert.Nil(t, afterClear.Email, "a blank email patch clears to null")
}

func TestPatchGuestHandler_InvalidEmailIs422(t *testing.T) {
	e := newAPI(t)
	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "Fam", "side": "robin", "relation": "family", "invitation_type": "digital",
	}))
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))
	add := do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests", map[string]any{"full_name": "Pat"})
	var guest struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(add.Body.Bytes(), &guest))

	// A present, non-blank, malformed email still fails format validation.
	rec := do(t, e, http.MethodPatch, "/api/admin/guests/"+guest.ID, map[string]any{"email": "not-an-email"})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestUpdateGuestHandler_PutReplacesFullState(t *testing.T) {
	e := newAPI(t)
	create := do(t, e, http.MethodPost, "/api/admin/parties", withGuest(map[string]any{
		"name": "Fam", "side": "robin", "relation": "family", "invitation_type": "digital",
	}))
	var party struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(create.Body.Bytes(), &party))
	add := do(t, e, http.MethodPost, "/api/admin/parties/"+party.ID+"/guests",
		map[string]any{"full_name": "Pat", "email": "pat@example.com", "is_child": true})
	var guest struct {
		ID string `json:"id"`
	}
	require.NoError(t, json.Unmarshal(add.Body.Bytes(), &guest))

	// PUT is the full-state dialog update: fields omitted from the body are reset
	// (is_child back to false, email cleared), unlike PATCH.
	put := do(t, e, http.MethodPut, "/api/admin/guests/"+guest.ID, map[string]any{"full_name": "Patricia"})
	require.Equal(t, http.StatusOK, put.Code)
	var got struct {
		FullName string  `json:"full_name"`
		Email    *string `json:"email"`
		IsChild  bool    `json:"is_child"`
	}
	require.NoError(t, json.Unmarshal(put.Body.Bytes(), &got))
	assert.Equal(t, "Patricia", got.FullName)
	assert.Nil(t, got.Email, "PUT resets an omitted optional field to null")
	assert.False(t, got.IsChild, "PUT resets an omitted flag to false")
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
