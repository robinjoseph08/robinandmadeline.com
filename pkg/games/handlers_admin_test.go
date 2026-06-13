package games_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/games"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAdminGamesEcho wires the games admin routes onto a bare Echo group with the
// shared error handler and the custom binder, but WITHOUT the admin auth
// middleware: these tests exercise the handlers, the list/delete behavior, and
// the response shapes, while auth enforcement on the admin group is covered in
// pkg/server. It uses the package's isolated Postgres test database.
func newAdminGamesEcho(t *testing.T, svc *games.Service) *echo.Echo {
	t.Helper()
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	games.RegisterAdminRoutes(e.Group("/api/admin"), svc)
	return e
}

// doAdmin issues a request against the admin games surface and returns the
// recorder. The list and delete endpoints take no body.
func doAdmin(t *testing.T, e *echo.Echo, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), method, target, http.NoBody)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestAdminListSessionsHandler_ReturnsEveryStateWithIPAndParty(t *testing.T) {
	svc, partySvc, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	// One solve of each state the admin must see, plus an affiliated one so
	// party_name is exercised over HTTP.
	startSessionT(t, svc, models.GameDifficultyMedium)              // in-progress
	completeSessionT(t, svc, models.GameDifficultyMedium, 42000)    // completed, unposted
	postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000) // posted
	p := createPartyT(t, partySvc, "The Smiths")
	_, err := svc.CreateSession(ctx(), games.CreateGameSessionPayload{
		PuzzleID:   "wedding-mini-v1",
		Difficulty: models.GameDifficultyEasy,
	}, p.ID, "203.0.113.7") // affiliated, in-progress
	require.NoError(t, err)

	rec := doAdmin(t, e, http.MethodGet, "/api/admin/games/sessions")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var resp games.ListAdminGameSessionsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, 4, resp.Total, "every solve is listed regardless of state")
	require.Len(t, resp.Items, 4)

	var sawInProgress, sawCompletedUnposted, sawPosted, sawAffiliated bool
	for _, it := range resp.Items {
		assert.Equal(t, "203.0.113.7", it.IPAddress, "the admin response exposes ip_address")
		switch {
		case it.PartyName != nil:
			sawAffiliated = true
			require.NotNil(t, it.PartyID)
			assert.Equal(t, p.ID, *it.PartyID)
			assert.Equal(t, "The Smiths", *it.PartyName)
		case it.OnLeaderboard:
			sawPosted = true
			require.NotNil(t, it.DisplayName)
			assert.Equal(t, "Alice", *it.DisplayName)
			assert.NotNil(t, it.CompletedAt)
		case it.CompletedAt != nil:
			sawCompletedUnposted = true
			assert.False(t, it.OnLeaderboard, "a completed-but-unposted solve is included and off the board")
			assert.Nil(t, it.DisplayName)
		default:
			sawInProgress = true
			assert.Nil(t, it.CompletedAt, "an in-progress solve has no completed_at")
		}
	}
	assert.True(t, sawInProgress, "the in-progress solve is listed")
	assert.True(t, sawCompletedUnposted, "the completed-but-unposted solve is listed")
	assert.True(t, sawPosted, "the posted solve is listed")
	assert.True(t, sawAffiliated, "the affiliated solve is listed with its party name")
}

func TestAdminListSessionsHandler_ExposesIPAddressKeyUnlikePublicResponse(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)
	startSessionT(t, svc, models.GameDifficultyEasy)

	rec := doAdmin(t, e, http.MethodGet, "/api/admin/games/sessions")
	require.Equal(t, http.StatusOK, rec.Code)

	// The admin item carries an ip_address key (the public GameSessionResponse
	// hides it). Decode the raw item to assert the key is present, not just the
	// typed value.
	var resp struct {
		Items []map[string]json.RawMessage `json:"items"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Len(t, resp.Items, 1)
	assert.Contains(t, resp.Items[0], "ip_address", "the admin view intentionally exposes ip_address")
	assert.Contains(t, resp.Items[0], "on_leaderboard")
	assert.Contains(t, resp.Items[0], "party_name")
	assert.Contains(t, resp.Items[0], "completed_at")
}

func TestAdminListSessionsHandler_EmptySerializesItemsAsEmptyArray(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	rec := doAdmin(t, e, http.MethodGet, "/api/admin/games/sessions")
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"items":[],"total":0}`, rec.Body.String())
}

func TestAdminDeleteSessionHandler_Returns204AndRemovesRow(t *testing.T) {
	svc, _, db := newServices(t)
	e := newAdminGamesEcho(t, svc)
	session := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)

	rec := doAdmin(t, e, http.MethodDelete, "/api/admin/games/sessions/"+session.ID)
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Empty(t, rec.Body.Bytes(), "a 204 carries no body")

	exists, err := db.NewSelect().Model((*models.GameSession)(nil)).
		Where("id = ?", session.ID).Exists(ctx())
	require.NoError(t, err)
	assert.False(t, exists, "the delete actually removes the row")
}

func TestAdminDeleteSessionHandler_UnknownIDIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	// A well-formed but unknown id is a 404 from the delete (0 rows affected).
	rec := doAdmin(t, e, http.MethodDelete, "/api/admin/games/sessions/00000000-0000-0000-0000-000000000000")
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errCodeOf(t, rec))
}

func TestAdminDeleteSessionHandler_MalformedIDIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	// A malformed id can never name a row, so pathID makes it a 404 before any
	// query rather than a 500 from a failing uuid cast.
	rec := doAdmin(t, e, http.MethodDelete, "/api/admin/games/sessions/not-a-uuid")
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errCodeOf(t, rec))
}
