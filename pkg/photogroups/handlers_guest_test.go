package photogroups_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/photogroups"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// guestAPI bundles the wired Echo instance with the services the guest-view
// tests build fixtures and tokens through.
type guestAPI struct {
	echo        *echo.Echo
	photoGroups *photogroups.Service
	parties     *parties.Service
	auth        *auth.Service
}

// newGuestAPI wires the guest-facing photo-groups route behind the real
// RequireGuest middleware (the party scoping IS this endpoint's contract, so
// the tests exercise it), with the shared error handler and binder. The
// bundled auth service mints guest tokens for the authenticated cases.
func newGuestAPI(t *testing.T) guestAPI {
	t.Helper()
	svc, partySvc := newServices(t)
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle

	authSvc := auth.NewService("test-secret", time.Hour, time.Hour, "admin", "pw")
	guest := e.Group("/api/guest")
	guest.Use(auth.NewMiddleware(authSvc).RequireGuest)
	photogroups.RegisterGuestRoutes(guest, svc)
	return guestAPI{echo: e, photoGroups: svc, parties: partySvc, auth: authSvc}
}

// getPartyPhotoGroups issues GET /api/guest/photo-groups with an optional
// bearer token.
func getPartyPhotoGroups(t *testing.T, e *echo.Echo, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/guest/photo-groups", http.NoBody)
	if token != "" {
		req.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// partyGroupsResponse is the decoded shape the guest-view tests assert on.
type partyGroupsResponse struct {
	Items []struct {
		ID         string   `json:"id"`
		Name       string   `json:"name"`
		Position   int      `json:"position"`
		GuestNames []string `json:"guest_names"`
	} `json:"items"`
	Total int `json:"total"`
}

func decodePartyGroups(t *testing.T, rec *httptest.ResponseRecorder) partyGroupsResponse {
	t.Helper()
	var resp partyGroupsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	return resp
}

func TestPartyPhotoGroupsHandler_RequiresGuestToken(t *testing.T) {
	api := newGuestAPI(t)

	rec := getPartyPhotoGroups(t, api.echo, "")
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, string(errcodes.CodeUnauthorized), errorCode(t, rec))
}

func TestPartyPhotoGroupsHandler_NamesThePartysGuestsPerGroup(t *testing.T) {
	api := newGuestAPI(t)

	smiths := createPartyT(t, api.parties, "The Smiths")
	// Created in non-alphabetical order and assigned to the first group in
	// the reverse of creation order, so the asserted names can only come from
	// party order (created_at, then id): alphabetical or assignment-time
	// ordering would flip them.
	zoe := addGuestT(t, api.parties, smiths.ID, "Zoe Smith")
	alice := addGuestT(t, api.parties, smiths.ID, "Alice Smith")
	joneses := createPartyT(t, api.parties, "The Joneses")
	riley := addGuestT(t, api.parties, joneses.ID, "Riley Jones")

	// Three groups in shooting order. The Smiths are in the first (both) and
	// the third (Alice only); the second holds only Riley, so it stays off the
	// Smiths' view but still counts toward positions. The first group also
	// holds Riley, proving guest_names is scoped to the requesting party even
	// when a group mixes parties.
	family := createGroupT(t, api.photoGroups, "Bride's Family")
	others := createGroupT(t, api.photoGroups, "Groom's Family")
	friends := createGroupT(t, api.photoGroups, "College Friends")
	assignGuestT(t, api.photoGroups, family.ID, alice.ID)
	assignGuestT(t, api.photoGroups, family.ID, zoe.ID)
	assignGuestT(t, api.photoGroups, family.ID, riley.ID)
	assignGuestT(t, api.photoGroups, others.ID, riley.ID)
	assignGuestT(t, api.photoGroups, friends.ID, alice.ID)

	token, err := api.auth.GenerateGuestToken(smiths.ID)
	require.NoError(t, err)

	rec := getPartyPhotoGroups(t, api.echo, token)
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodePartyGroups(t, rec)
	require.Equal(t, 2, resp.Total)
	require.Len(t, resp.Items, 2)

	first := resp.Items[0]
	assert.Equal(t, family.ID, first.ID)
	assert.Equal(t, "Bride's Family", first.Name)
	assert.Equal(t, 1, first.Position)
	// Only the Smiths' guests, in party order (Zoe joined the party first);
	// Riley is invisible to them.
	assert.Equal(t, []string{"Zoe Smith", "Alice Smith"}, first.GuestNames)

	second := resp.Items[1]
	assert.Equal(t, friends.ID, second.ID)
	assert.Equal(t, 3, second.Position)
	assert.Equal(t, []string{"Alice Smith"}, second.GuestNames)
}

func TestPartyPhotoGroupsHandler_NoAssignmentsIsEmptyList(t *testing.T) {
	api := newGuestAPI(t)

	smiths := createPartyT(t, api.parties, "The Smiths")
	addGuestT(t, api.parties, smiths.ID, "Alice Smith")
	createGroupT(t, api.photoGroups, "Bride's Family")

	token, err := api.auth.GenerateGuestToken(smiths.ID)
	require.NoError(t, err)

	rec := getPartyPhotoGroups(t, api.echo, token)
	require.Equal(t, http.StatusOK, rec.Code)
	// The uniform list envelope: items serializes as [], never null.
	assert.JSONEq(t, `{"items":[],"total":0}`, rec.Body.String())
}

func TestPartyPhotoGroupsHandler_PositionsReRankAfterADelete(t *testing.T) {
	api := newGuestAPI(t)

	smiths := createPartyT(t, api.parties, "The Smiths")
	alice := addGuestT(t, api.parties, smiths.ID, "Alice Smith")

	createGroupT(t, api.photoGroups, "Bride's Family")
	second := createGroupT(t, api.photoGroups, "Groom's Family")
	third := createGroupT(t, api.photoGroups, "College Friends")
	assignGuestT(t, api.photoGroups, third.ID, alice.ID)

	// Deleting the middle group leaves a sort_order gap; positions are ranks,
	// so the third group becomes group 2, not group 3.
	require.NoError(t, api.photoGroups.DeletePhotoGroup(ctx(), second.ID))

	token, err := api.auth.GenerateGuestToken(smiths.ID)
	require.NoError(t, err)

	rec := getPartyPhotoGroups(t, api.echo, token)
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodePartyGroups(t, rec)
	require.Len(t, resp.Items, 1)
	assert.Equal(t, third.ID, resp.Items[0].ID)
	assert.Equal(t, 2, resp.Items[0].Position)
}
