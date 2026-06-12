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
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/photogroups"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fixtures bundles the services the handler tests build test data through.
type fixtures struct {
	photoGroups *photogroups.Service
	parties     *parties.Service
}

// newAPI wires the photo-groups admin routes onto a bare Echo group with the
// shared error handler AND the custom binder (no auth middleware: these tests
// exercise the handlers, validation pipeline, and response shapes, while auth
// enforcement is covered by the server package). It uses the package's
// isolated Postgres test database; the returned fixtures build test data.
func newAPI(t *testing.T) (*echo.Echo, fixtures) {
	t.Helper()
	svc, partySvc := newServices(t)
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	g := e.Group("/api/admin")
	photogroups.RegisterRoutes(g, svc)
	return e, fixtures{photoGroups: svc, parties: partySvc}
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

func TestCreatePhotoGroupHandler_AppendsAtEndOfList(t *testing.T) {
	e, _ := newAPI(t)

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups", map[string]any{
		"name": "Bride's Family",
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	first := decodeGroup(t, rec)
	assert.NotEmpty(t, first.ID)
	assert.Equal(t, "Bride's Family", first.Name)
	assert.Equal(t, 1, first.SortOrder)
	// guests is always present, an empty list for a fresh group, never null.
	assert.NotNil(t, first.Guests)
	assert.Empty(t, first.Guests)

	rec = do(t, e, http.MethodPost, "/api/admin/photo-groups", map[string]any{
		"name": "College Friends",
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	assert.Equal(t, 2, decodeGroup(t, rec).SortOrder)
}

func TestCreatePhotoGroupHandler_MissingNameIs422(t *testing.T) {
	e, _ := newAPI(t)

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups", map[string]any{})
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

func TestListPhotoGroupsHandler_ListsInShootingOrderWithMembers(t *testing.T) {
	e, fx := newAPI(t)

	family := createGroupT(t, fx.photoGroups, "Bride's Family")
	friends := createGroupT(t, fx.photoGroups, "College Friends")

	p := createPartyT(t, fx.parties, "The Smiths")
	alice := addGuestT(t, fx.parties, p.ID, "Alice")
	assignGuestT(t, fx.photoGroups, family.ID, alice.ID)

	rec := do(t, e, http.MethodGet, "/api/admin/photo-groups", nil)
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeList(t, rec)
	require.Equal(t, 2, resp.Total)
	require.Len(t, resp.Items, 2)
	// Shooting order.
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

func TestListPhotoGroupsHandler_EmptyListIsEmptyEnvelope(t *testing.T) {
	e, _ := newAPI(t)

	rec := do(t, e, http.MethodGet, "/api/admin/photo-groups", nil)
	require.Equal(t, http.StatusOK, rec.Code)
	// The uniform list envelope: items serializes as [], never null.
	assert.JSONEq(t, `{"items":[],"total":0}`, rec.Body.String())
}

func TestUpdatePhotoGroupHandler_RenamesGroup(t *testing.T) {
	e, fx := newAPI(t)
	group := createGroupT(t, fx.photoGroups, "Bride's Family")

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

	group := createGroupT(t, fx.photoGroups, "Bride's Family")
	p := createPartyT(t, fx.parties, "The Smiths")
	alice := addGuestT(t, fx.parties, p.ID, "Alice")
	assignGuestT(t, fx.photoGroups, group.ID, alice.ID)

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
	family := createGroupT(t, fx.photoGroups, "Bride's Family")
	friends := createGroupT(t, fx.photoGroups, "College Friends")
	wedding := createGroupT(t, fx.photoGroups, "Wedding Party")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/reorder", map[string]any{
		"photo_group_ids": []string{wedding.ID, family.ID, friends.ID},
	})
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeList(t, rec)
	require.Len(t, resp.Items, 3)
	assert.Equal(t, []string{wedding.ID, family.ID, friends.ID}, []string{
		resp.Items[0].ID, resp.Items[1].ID, resp.Items[2].ID,
	})
	assert.Equal(t, 1, resp.Items[0].SortOrder)
	assert.Equal(t, 2, resp.Items[1].SortOrder)
	assert.Equal(t, 3, resp.Items[2].SortOrder)
}

func TestReorderPhotoGroupsHandler_IncompleteSetIs422(t *testing.T) {
	e, fx := newAPI(t)
	family := createGroupT(t, fx.photoGroups, "Bride's Family")
	createGroupT(t, fx.photoGroups, "College Friends")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/reorder", map[string]any{
		"photo_group_ids": []string{family.ID},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestReorderPhotoGroupsHandler_DuplicateIDIs422(t *testing.T) {
	e, fx := newAPI(t)
	family := createGroupT(t, fx.photoGroups, "Bride's Family")
	createGroupT(t, fx.photoGroups, "College Friends")

	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/reorder", map[string]any{
		"photo_group_ids": []string{family.ID, family.ID},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestReorderPhotoGroupsHandler_UnknownIDIs422(t *testing.T) {
	e, fx := newAPI(t)
	family := createGroupT(t, fx.photoGroups, "Bride's Family")
	createGroupT(t, fx.photoGroups, "College Friends")

	// The right count, but one id names no group: rejected as a whole, and the
	// existing positions are untouched.
	rec := do(t, e, http.MethodPost, "/api/admin/photo-groups/reorder", map[string]any{
		"photo_group_ids": []string{"01933a3e-0000-7000-8000-000000000000", family.ID},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))

	rec = do(t, e, http.MethodGet, "/api/admin/photo-groups", nil)
	require.Equal(t, http.StatusOK, rec.Code)
	resp := decodeList(t, rec)
	require.Len(t, resp.Items, 2)
	assert.Equal(t, family.ID, resp.Items[0].ID)
	assert.Equal(t, 1, resp.Items[0].SortOrder)
}

func TestAddGuestHandler_ReturnsRefreshedMembersAndIsIdempotent(t *testing.T) {
	e, fx := newAPI(t)
	group := createGroupT(t, fx.photoGroups, "Bride's Family")
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
	group := createGroupT(t, fx.photoGroups, "Bride's Family")

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
	group := createGroupT(t, fx.photoGroups, "Bride's Family")
	p := createPartyT(t, fx.parties, "The Smiths")
	alice := addGuestT(t, fx.parties, p.ID, "Alice")
	assignGuestT(t, fx.photoGroups, group.ID, alice.ID)

	rec := do(t, e, http.MethodDelete, "/api/admin/photo-groups/"+group.ID+"/guests/"+alice.ID, nil)
	assert.Equal(t, http.StatusNoContent, rec.Code)

	// The removal is visible in the list.
	rec = do(t, e, http.MethodGet, "/api/admin/photo-groups", nil)
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Empty(t, decodeList(t, rec).Items[0].Guests)
}

func TestRemoveGuestHandler_MissingMembershipIs404(t *testing.T) {
	e, fx := newAPI(t)
	group := createGroupT(t, fx.photoGroups, "Groom's Family")
	p := createPartyT(t, fx.parties, "The Joneses")
	riley := addGuestT(t, fx.parties, p.ID, "Riley")

	rec := do(t, e, http.MethodDelete, "/api/admin/photo-groups/"+group.ID+"/guests/"+riley.ID, nil)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}
