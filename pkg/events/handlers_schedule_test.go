package events_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/photogroups"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// scheduleAPI bundles the wired Echo instance with the services the schedule
// tests build fixtures and tokens through (and the db handle, through which
// the photo-group tests construct a photogroups.Service for fixtures).
type scheduleAPI struct {
	echo    *echo.Echo
	events  *events.Service
	parties *parties.Service
	auth    *auth.Service
	db      *bun.DB
}

// newScheduleAPI wires the schedule route behind the real auth middleware
// (unlike newAPI: the optional-guest behavior IS this endpoint's contract, so
// the tests exercise it), with the shared error handler and binder. The
// bundled auth service mints guest tokens for the authenticated cases.
func newScheduleAPI(t *testing.T) scheduleAPI {
	t.Helper()
	svc, partySvc, db := newServices(t)
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle

	authSvc := auth.NewService("test-secret", time.Hour, time.Hour, "admin", "pw")
	g := e.Group("/api")
	events.RegisterScheduleRoutes(g, auth.NewMiddleware(authSvc), svc)
	return scheduleAPI{echo: e, events: svc, parties: partySvc, auth: authSvc, db: db}
}

// getSchedule issues GET /api/events with an optional bearer token.
func getSchedule(t *testing.T, e *echo.Echo, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/events", http.NoBody)
	if token != "" {
		req.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// scheduleResponse is the decoded shape the schedule tests assert on.
type scheduleResponse struct {
	Items []struct {
		ID          string  `json:"id"`
		Name        string  `json:"name"`
		Description *string `json:"description"`
		Location    *string `json:"location"`
		Date        string  `json:"date"`
		StartTime   *string `json:"start_time"`
		EndTime     *string `json:"end_time"`
		IsPublic    bool    `json:"is_public"`
		PhotoGroups []struct {
			ID       string `json:"id"`
			Name     string `json:"name"`
			Position int    `json:"position"`
			Total    int    `json:"total"`
		} `json:"photo_groups"`
	} `json:"items"`
	Total int `json:"total"`
}

func decodeSchedule(t *testing.T, rec *httptest.ResponseRecorder) scheduleResponse {
	t.Helper()
	var resp scheduleResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	return resp
}

func TestScheduleHandler_NoTokenListsOnlyPublicEvents(t *testing.T) {
	api := newScheduleAPI(t)

	public := publicEventInput()
	public.Description = pointerutil.String("Dinner and dancing.")
	public.Location = pointerutil.String("The Grand Hall")
	public.StartTime = pointerutil.String("17:00")
	public.EndTime = pointerutil.String("22:00")
	createEventT(t, api.events, public)
	createEventT(t, api.events, privateEventInput())

	rec := getSchedule(t, api.echo, "")
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeSchedule(t, rec)
	require.Equal(t, 1, resp.Total)
	require.Len(t, resp.Items, 1)
	item := resp.Items[0]
	assert.Equal(t, "Reception", item.Name)
	assert.Equal(t, "2026-10-17", item.Date)
	assert.Equal(t, pointerutil.String("17:00"), item.StartTime)
	assert.Equal(t, pointerutil.String("22:00"), item.EndTime)
	assert.Equal(t, pointerutil.String("The Grand Hall"), item.Location)
	assert.Equal(t, pointerutil.String("Dinner and dancing."), item.Description)
	assert.True(t, item.IsPublic)
	// photo_groups is always present, an empty list on the anonymous view
	// (assignments are personal data), never null.
	assert.NotNil(t, item.PhotoGroups)
	assert.Empty(t, item.PhotoGroups)
}

func TestScheduleHandler_GuestTokenCarriesPartyPhotoGroupsWithPositions(t *testing.T) {
	api := newScheduleAPI(t)
	photoSvc := photogroups.NewService(api.db)

	p := createPartyT(t, api.parties, "The Smiths")
	alice := addGuestT(t, api.parties, p.ID, "Alice")
	bob := addGuestT(t, api.parties, p.ID, "Bob")
	other := createPartyT(t, api.parties, "The Joneses")
	riley := addGuestT(t, api.parties, other.ID, "Riley")

	event := createEventT(t, api.events, publicEventInput())

	// Three groups in shooting order; Alice is in the first, Bob in the third,
	// and only Riley (another party) in the second, so the party's view is the
	// union of its guests' groups with positions ranked across ALL of the
	// event's groups.
	family, err := photoSvc.CreatePhotoGroup(ctx(), photogroups.CreatePhotoGroupPayload{EventID: event.ID, Name: "Bride's Family"})
	require.NoError(t, err)
	joneses, err := photoSvc.CreatePhotoGroup(ctx(), photogroups.CreatePhotoGroupPayload{EventID: event.ID, Name: "The Joneses"})
	require.NoError(t, err)
	friends, err := photoSvc.CreatePhotoGroup(ctx(), photogroups.CreatePhotoGroupPayload{EventID: event.ID, Name: "College Friends"})
	require.NoError(t, err)
	_, err = photoSvc.AddGuest(ctx(), family.ID, photogroups.AddPhotoGroupGuestPayload{GuestID: alice.ID})
	require.NoError(t, err)
	_, err = photoSvc.AddGuest(ctx(), friends.ID, photogroups.AddPhotoGroupGuestPayload{GuestID: bob.ID})
	require.NoError(t, err)
	_, err = photoSvc.AddGuest(ctx(), joneses.ID, photogroups.AddPhotoGroupGuestPayload{GuestID: riley.ID})
	require.NoError(t, err)

	token, err := api.auth.GenerateGuestToken(p.ID)
	require.NoError(t, err)

	rec := getSchedule(t, api.echo, token)
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeSchedule(t, rec)
	require.Len(t, resp.Items, 1)
	groups := resp.Items[0].PhotoGroups
	require.Len(t, groups, 2)
	// Shooting order; the other party's group never appears but still counts
	// toward positions and the total.
	assert.Equal(t, family.ID, groups[0].ID)
	assert.Equal(t, "Bride's Family", groups[0].Name)
	assert.Equal(t, 1, groups[0].Position)
	assert.Equal(t, 3, groups[0].Total)
	assert.Equal(t, friends.ID, groups[1].ID)
	assert.Equal(t, "College Friends", groups[1].Name)
	assert.Equal(t, 3, groups[1].Position)
	assert.Equal(t, 3, groups[1].Total)
}

func TestScheduleHandler_GuestWithNoAssignmentsGetsEmptyPhotoGroups(t *testing.T) {
	api := newScheduleAPI(t)
	photoSvc := photogroups.NewService(api.db)

	p := createPartyT(t, api.parties, "The Smiths")
	addGuestT(t, api.parties, p.ID, "Alice")
	event := createEventT(t, api.events, publicEventInput())
	_, err := photoSvc.CreatePhotoGroup(ctx(), photogroups.CreatePhotoGroupPayload{EventID: event.ID, Name: "Bride's Family"})
	require.NoError(t, err)

	token, err := api.auth.GenerateGuestToken(p.ID)
	require.NoError(t, err)

	rec := getSchedule(t, api.echo, token)
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeSchedule(t, rec)
	require.Len(t, resp.Items, 1)
	// Present and empty, never null: the event has groups, just none of ours.
	assert.NotNil(t, resp.Items[0].PhotoGroups)
	assert.Empty(t, resp.Items[0].PhotoGroups)
}

func TestScheduleHandler_GuestTokenListsInvitedEventsInScheduleOrder(t *testing.T) {
	api := newScheduleAPI(t)

	p := createPartyT(t, api.parties, "The Smiths")
	addGuestT(t, api.parties, p.ID, "Alice")

	createEventT(t, api.events, publicEventInput())
	invited := createEventT(t, api.events, privateEventInput())
	_, err := api.events.InviteParties(ctx(), invited.ID, events.InvitePartiesPayload{PartyIDs: []string{p.ID}})
	require.NoError(t, err)
	// The uninvited private event carries another party's invitation, so it
	// has Event RSVP rows; only party scoping keeps it off this schedule.
	other := createPartyT(t, api.parties, "The Joneses")
	addGuestT(t, api.parties, other.ID, "Riley")
	uninvitedInput := privateEventInput()
	uninvitedInput.Name = "Bridal Party Photos"
	uninvited := createEventT(t, api.events, uninvitedInput)
	_, err = api.events.InviteParties(ctx(), uninvited.ID, events.InvitePartiesPayload{PartyIDs: []string{other.ID}})
	require.NoError(t, err)

	token, err := api.auth.GenerateGuestToken(p.ID)
	require.NoError(t, err)

	rec := getSchedule(t, api.echo, token)
	require.Equal(t, http.StatusOK, rec.Code)

	resp := decodeSchedule(t, rec)
	require.Equal(t, 2, resp.Total)
	require.Len(t, resp.Items, 2)
	// Schedule order: the invited private Rehearsal Dinner (2026-10-16)
	// precedes the public Reception (2026-10-17); the uninvited private event
	// never appears.
	assert.Equal(t, "Rehearsal Dinner", resp.Items[0].Name)
	assert.False(t, resp.Items[0].IsPublic)
	assert.Equal(t, "Reception", resp.Items[1].Name)
	assert.True(t, resp.Items[1].IsPublic)
}

func TestScheduleHandler_InvalidTokenIs401(t *testing.T) {
	api := newScheduleAPI(t)
	createEventT(t, api.events, publicEventInput())

	rec := getSchedule(t, api.echo, "not-a-real-jwt")
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Equal(t, string(errcodes.CodeUnauthorized), errorCode(t, rec))
}

func TestScheduleHandler_EmptyScheduleIsEmptyList(t *testing.T) {
	api := newScheduleAPI(t)

	rec := getSchedule(t, api.echo, "")
	require.Equal(t, http.StatusOK, rec.Code)
	// The uniform list envelope: items serializes as [], never null.
	assert.JSONEq(t, `{"items":[],"total":0}`, rec.Body.String())
}
