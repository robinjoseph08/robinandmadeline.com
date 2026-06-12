package photogroups_test

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
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/photogroups"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fixtures bundles the services the handler tests build test data through.
type fixtures struct {
	photoGroups *photogroups.Service
	events      *events.Service
	parties     *parties.Service
}

// newAPI wires the photo-groups routes onto a bare Echo group with the shared
// error handler AND the custom binder (no auth middleware: these tests
// exercise the handlers, validation pipeline, and response shapes, while auth
// enforcement is covered by the server package). It uses the package's
// isolated Postgres test database; the returned fixtures build test data.
func newAPI(t *testing.T) (*echo.Echo, fixtures) {
	t.Helper()
	svc, eventSvc, partySvc, _ := newServices(t)
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	g := e.Group("/api/admin")
	photogroups.RegisterRoutes(g, svc)
	return e, fixtures{photoGroups: svc, events: eventSvc, parties: partySvc}
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

// groupResponse is the decoded single-group shape the tests assert on.
type groupResponse struct {
	ID        string `json:"id"`
	EventID   string `json:"event_id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
	Guests    []struct {
		GuestID   string `json:"guest_id"`
		GuestName string `json:"guest_name"`
		PartyID   string `json:"party_id"`
		PartyName string `json:"party_name"`
	} `json:"guests"`
}

func decodeGroup(t *testing.T, rec *httptest.ResponseRecorder) groupResponse {
	t.Helper()
	var resp groupResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	return resp
}

func TestCreatePhotoGroupHandler_AppendsAtEndOfEvent(t *testing.T) {
	e, fx := newAPI(t)
	event := createEventT(t, fx.events, "Ceremony")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups", map[string]any{
		"event_id": event.ID, "name": "Bride's Family",
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	first := decodeGroup(t, rec)
	assert.NotEmpty(t, first.ID)
	assert.Equal(t, event.ID, first.EventID)
	assert.Equal(t, "Bride's Family", first.Name)
	assert.Equal(t, 1, first.SortOrder)
	// guests is always present, an empty list for a fresh group, never null.
	assert.NotNil(t, first.Guests)
	assert.Empty(t, first.Guests)

	rec = do(t, e, http.MethodPost, "/api/admin/photo-groups", map[string]any{
		"event_id": event.ID, "name": "College Friends",
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	assert.Equal(t, 2, decodeGroup(t, rec).SortOrder)

	// The order is per event: a sibling event's first group starts at 1.
	other := createEventT(t, fx.events, "Reception")
	rec = do(t, e, http.MethodPost, "/api/admin/photo-groups", map[string]any{
		"event_id": other.ID, "name": "Wedding Party",
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	assert.Equal(t, 1, decodeGroup(t, rec).SortOrder)
}

func TestCreatePhotoGroupHandler_UnknownEventIs422(t *testing.T) {
	e, _ := newAPI(t)

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups", map[string]any{
		"event_id": "01933a3e-0000-7000-8000-000000000000", "name": "Bride's Family",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestCreatePhotoGroupHandler_MissingNameIs422(t *testing.T) {
	e, fx := newAPI(t)
	event := createEventT(t, fx.events, "Ceremony")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups", map[string]any{
		"event_id": event.ID,
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

// listResponse is the decoded list envelope the tests assert on.
type listResponse struct {
	Items []groupResponse `json:"items"`
	Total int             `json:"total"`
}

func decodeList(t *testing.T, rec *httptest.ResponseRecorder) listResponse {
	t.Helper()
	var resp listResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	return resp
}

func TestListPhotoGroupsHandler_FiltersByEventAndCarriesMembers(t *testing.T) {
	e, fx := newAPI(t)

	ceremony := createEventT(t, fx.events, "Ceremony")
	reception := createEventT(t, fx.events, "Reception")
	family := createGroupT(t, fx.photoGroups, ceremony.ID, "Bride's Family")
	friends := createGroupT(t, fx.photoGroups, ceremony.ID, "College Friends")
	createGroupT(t, fx.photoGroups, reception.ID, "Wedding Party")

	p := createPartyT(t, fx.parties, "The Smiths")
	alice := addGuestT(t, fx.parties, p.ID, "Alice")
	_, err := fx.photoGroups.AddGuest(ctx(), family.ID, photogroups.AddPhotoGroupGuestPayload{GuestID: alice.ID})
	require.NoError(t, err)

	rec := do(t, e, http.MethodGet, "/api/admin/photo-groups?event_id="+ceremony.ID, nil)
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeList(t, rec)
	require.Equal(t, 2, resp.Total)
	require.Len(t, resp.Items, 2)
	// Shooting order within the event.
	assert.Equal(t, family.ID, resp.Items[0].ID)
	assert.Equal(t, friends.ID, resp.Items[1].ID)
	// The member carries guest and party context for the admin UI.
	require.Len(t, resp.Items[0].Guests, 1)
	member := resp.Items[0].Guests[0]
	assert.Equal(t, alice.ID, member.GuestID)
	assert.Equal(t, "Alice", member.GuestName)
	assert.Equal(t, p.ID, member.PartyID)
	assert.Equal(t, "The Smiths", member.PartyName)
	// The memberless group serializes guests as [], never null.
	assert.NotNil(t, resp.Items[1].Guests)
	assert.Empty(t, resp.Items[1].Guests)
}

func TestListPhotoGroupsHandler_NoFilterListsAllEvents(t *testing.T) {
	e, fx := newAPI(t)

	ceremony := createEventT(t, fx.events, "Ceremony")
	reception := createEventT(t, fx.events, "Reception")
	createGroupT(t, fx.photoGroups, ceremony.ID, "Bride's Family")
	createGroupT(t, fx.photoGroups, reception.ID, "Wedding Party")

	rec := do(t, e, http.MethodGet, "/api/admin/photo-groups", nil)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, 2, decodeList(t, rec).Total)
}

func TestListPhotoGroupsHandler_MalformedEventIDIs422(t *testing.T) {
	e, _ := newAPI(t)

	rec := do(t, e, http.MethodGet, "/api/admin/photo-groups?event_id=nope", nil)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestUpdatePhotoGroupHandler_RenamesGroup(t *testing.T) {
	e, fx := newAPI(t)
	event := createEventT(t, fx.events, "Ceremony")
	group := createGroupT(t, fx.photoGroups, event.ID, "Bride's Family")

	rec := do(t, e, http.MethodPut, "/api/admin/photo-groups/"+group.ID, map[string]any{
		"name": "Bride's Immediate Family",
	})
	require.Equal(t, http.StatusOK, rec.Code)
	resp := decodeGroup(t, rec)
	assert.Equal(t, "Bride's Immediate Family", resp.Name)
	// Renaming never moves the group.
	assert.Equal(t, group.SortOrder, resp.SortOrder)
}

func TestUpdatePhotoGroupHandler_MissingGroupIs404(t *testing.T) {
	e, _ := newAPI(t)

	rec := do(t, e, http.MethodPut, "/api/admin/photo-groups/01933a3e-0000-7000-8000-000000000000", map[string]any{
		"name": "Renamed",
	})
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}

func TestUpdatePhotoGroupHandler_MalformedIDIs404(t *testing.T) {
	e, _ := newAPI(t)

	rec := do(t, e, http.MethodPut, "/api/admin/photo-groups/not-a-uuid", map[string]any{
		"name": "Renamed",
	})
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}

func TestDeletePhotoGroupHandler_Returns204AndCascadesAssignments(t *testing.T) {
	e, fx := newAPI(t)
	// A second connection to the package's database (no re-truncation) for the
	// persisted-state assertion below.
	db := databasetest.NewIsolated(t, "robinandmadeline_photogroups_test")

	event := createEventT(t, fx.events, "Ceremony")
	group := createGroupT(t, fx.photoGroups, event.ID, "Bride's Family")
	p := createPartyT(t, fx.parties, "The Smiths")
	alice := addGuestT(t, fx.parties, p.ID, "Alice")
	_, err := fx.photoGroups.AddGuest(ctx(), group.ID, photogroups.AddPhotoGroupGuestPayload{GuestID: alice.ID})
	require.NoError(t, err)

	rec := do(t, e, http.MethodDelete, "/api/admin/photo-groups/"+group.ID, nil)
	assert.Equal(t, http.StatusNoContent, rec.Code)

	count, err := db.NewSelect().Model((*models.PhotoGroupAssignment)(nil)).
		Where("photo_group_id = ?", group.ID).Count(ctx())
	require.NoError(t, err)
	assert.Zero(t, count)
}

func TestDeletePhotoGroupHandler_MissingGroupIs404(t *testing.T) {
	e, _ := newAPI(t)

	rec := do(t, e, http.MethodDelete, "/api/admin/photo-groups/01933a3e-0000-7000-8000-000000000000", nil)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}

func TestReorderPhotoGroupsHandler_RewritesOrder(t *testing.T) {
	e, fx := newAPI(t)
	event := createEventT(t, fx.events, "Ceremony")
	family := createGroupT(t, fx.photoGroups, event.ID, "Bride's Family")
	friends := createGroupT(t, fx.photoGroups, event.ID, "College Friends")
	party := createGroupT(t, fx.photoGroups, event.ID, "Wedding Party")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/reorder", map[string]any{
		"event_id":        event.ID,
		"photo_group_ids": []string{party.ID, family.ID, friends.ID},
	})
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeList(t, rec)
	require.Len(t, resp.Items, 3)
	assert.Equal(t, []string{party.ID, family.ID, friends.ID}, []string{
		resp.Items[0].ID, resp.Items[1].ID, resp.Items[2].ID,
	})
	assert.Equal(t, 1, resp.Items[0].SortOrder)
	assert.Equal(t, 2, resp.Items[1].SortOrder)
	assert.Equal(t, 3, resp.Items[2].SortOrder)
}

func TestReorderPhotoGroupsHandler_IncompleteSetIs422(t *testing.T) {
	e, fx := newAPI(t)
	event := createEventT(t, fx.events, "Ceremony")
	family := createGroupT(t, fx.photoGroups, event.ID, "Bride's Family")
	createGroupT(t, fx.photoGroups, event.ID, "College Friends")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/reorder", map[string]any{
		"event_id":        event.ID,
		"photo_group_ids": []string{family.ID},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestReorderPhotoGroupsHandler_DuplicateIDIs422(t *testing.T) {
	e, fx := newAPI(t)
	event := createEventT(t, fx.events, "Ceremony")
	family := createGroupT(t, fx.photoGroups, event.ID, "Bride's Family")
	createGroupT(t, fx.photoGroups, event.ID, "College Friends")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/reorder", map[string]any{
		"event_id":        event.ID,
		"photo_group_ids": []string{family.ID, family.ID},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestReorderPhotoGroupsHandler_OtherEventsGroupIs422(t *testing.T) {
	e, fx := newAPI(t)
	ceremony := createEventT(t, fx.events, "Ceremony")
	reception := createEventT(t, fx.events, "Reception")
	family := createGroupT(t, fx.photoGroups, ceremony.ID, "Bride's Family")
	createGroupT(t, fx.photoGroups, ceremony.ID, "College Friends")
	wedding := createGroupT(t, fx.photoGroups, reception.ID, "Wedding Party")

	// The right count, but one id belongs to another event: rejected as a
	// whole, so a reorder can never reach across events.
	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/reorder", map[string]any{
		"event_id":        ceremony.ID,
		"photo_group_ids": []string{wedding.ID, family.ID},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))

	// The foreign group's position is untouched.
	rec = do(t, e, http.MethodGet, "/api/admin/photo-groups?event_id="+reception.ID, nil)
	require.Equal(t, http.StatusOK, rec.Code)
	resp := decodeList(t, rec)
	require.Len(t, resp.Items, 1)
	assert.Equal(t, 1, resp.Items[0].SortOrder)
}

func TestAddGuestHandler_ReturnsRefreshedMembersAndIsIdempotent(t *testing.T) {
	e, fx := newAPI(t)
	event := createEventT(t, fx.events, "Ceremony")
	group := createGroupT(t, fx.photoGroups, event.ID, "Bride's Family")
	p := createPartyT(t, fx.parties, "The Smiths")
	alice := addGuestT(t, fx.parties, p.ID, "Alice")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/"+group.ID+"/guests", map[string]any{
		"guest_id": alice.ID,
	})
	require.Equal(t, http.StatusOK, rec.Code)
	resp := decodeGroup(t, rec)
	require.Len(t, resp.Guests, 1)
	assert.Equal(t, alice.ID, resp.Guests[0].GuestID)
	assert.Equal(t, "Alice", resp.Guests[0].GuestName)

	// Re-adding is an idempotent no-op: still one membership.
	rec = do(t, e, http.MethodPost, "/api/admin/photo-groups/"+group.ID+"/guests", map[string]any{
		"guest_id": alice.ID,
	})
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Len(t, decodeGroup(t, rec).Guests, 1)

	// A second member appends after the first: members keep insertion order
	// (created_at, then guest id), so the list never reshuffles.
	bob := addGuestT(t, fx.parties, p.ID, "Bob")
	rec = do(t, e, http.MethodPost, "/api/admin/photo-groups/"+group.ID+"/guests", map[string]any{
		"guest_id": bob.ID,
	})
	require.Equal(t, http.StatusOK, rec.Code)
	resp = decodeGroup(t, rec)
	require.Len(t, resp.Guests, 2)
	assert.Equal(t, alice.ID, resp.Guests[0].GuestID)
	assert.Equal(t, bob.ID, resp.Guests[1].GuestID)
}

func TestAddGuestHandler_UnknownGuestIs422(t *testing.T) {
	e, fx := newAPI(t)
	event := createEventT(t, fx.events, "Ceremony")
	group := createGroupT(t, fx.photoGroups, event.ID, "Bride's Family")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/"+group.ID+"/guests", map[string]any{
		"guest_id": "01933a3e-0000-7000-8000-000000000000",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestAddGuestHandler_MissingGroupIs404(t *testing.T) {
	e, fx := newAPI(t)
	p := createPartyT(t, fx.parties, "The Smiths")
	alice := addGuestT(t, fx.parties, p.ID, "Alice")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/01933a3e-0000-7000-8000-000000000000/guests", map[string]any{
		"guest_id": alice.ID,
	})
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}

func TestRemoveGuestHandler_Returns204(t *testing.T) {
	e, fx := newAPI(t)
	event := createEventT(t, fx.events, "Ceremony")
	group := createGroupT(t, fx.photoGroups, event.ID, "Bride's Family")
	p := createPartyT(t, fx.parties, "The Smiths")
	alice := addGuestT(t, fx.parties, p.ID, "Alice")
	_, err := fx.photoGroups.AddGuest(ctx(), group.ID, photogroups.AddPhotoGroupGuestPayload{GuestID: alice.ID})
	require.NoError(t, err)

	rec := do(t, e, http.MethodDelete, "/api/admin/photo-groups/"+group.ID+"/guests/"+alice.ID, nil)
	assert.Equal(t, http.StatusNoContent, rec.Code)

	// The removal is visible in the list.
	rec = do(t, e, http.MethodGet, "/api/admin/photo-groups?event_id="+event.ID, nil)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, decodeList(t, rec).Items[0].Guests)
}

func TestRemoveGuestHandler_MissingMembershipIs404(t *testing.T) {
	e, fx := newAPI(t)
	event := createEventT(t, fx.events, "Reception")
	group := createGroupT(t, fx.photoGroups, event.ID, "Groom's Family")
	p := createPartyT(t, fx.parties, "The Joneses")
	riley := addGuestT(t, fx.parties, p.ID, "Riley")

	rec := do(t, e, http.MethodDelete, "/api/admin/photo-groups/"+group.ID+"/guests/"+riley.ID, nil)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}
