package games_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/games"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAdminGamesEcho wires the games admin routes onto a bare Echo group with the
// shared error handler and the custom binder, but WITHOUT the admin auth
// middleware: these tests exercise the handlers, the list/moderation behavior, and
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
// recorder. The list and moderation endpoints take no body.
func doAdmin(t *testing.T, e *echo.Echo, method, target string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), method, target, http.NoBody)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// postAdminJSON POSTs a JSON body to the admin games surface
// and returns the recorder.
func postAdminJSON(t *testing.T, e *echo.Echo, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, target, strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestAdminListSessionsHandler_ReturnsEveryStateWithClientAndParty(t *testing.T) {
	svc, partySvc, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	// One solve of each state the admin must see, plus an affiliated one so
	// party_name is exercised over HTTP.
	startSessionT(t, svc, models.GameDifficultyMedium)           // in-progress
	completeSessionT(t, svc, models.GameDifficultyMedium, 42000) // completed, unposted
	checked := startSessionT(t, svc, models.GameDifficultyEasy)
	_, err := svc.UpdateSession(ctx(), checked.ID, games.UpdateGameSessionPayload{
		ElapsedMS:    pointerutil.Int(30000),
		Completed:    true,
		SquareChecks: pointerutil.Int(2),
		WordChecks:   pointerutil.Int(1),
	}, "")
	require.NoError(t, err)
	_, err = svc.PostToLeaderboard(ctx(), checked.ID, games.PostLeaderboardPayload{DisplayName: "Alice"}, "")
	require.NoError(t, err)
	p := createPartyT(t, partySvc, "The Smiths")
	_, err = svc.CreateSession(ctx(), games.CreateGameSessionInput{
		Payload: games.CreateGameSessionPayload{
			PuzzleID:   "wedding-mini-v1",
			Difficulty: models.GameDifficultyEasy,
		},
		PartyID:   p.ID,
		IPAddress: "203.0.113.7",
		UserAgent: "games-service-test",
	}) // affiliated, in-progress
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
		assert.Equal(t, "games-service-test", it.UserAgent, "the admin response exposes user_agent")
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
			assert.EqualValues(t, 2, it.SquareChecks)
			assert.EqualValues(t, 1, it.WordChecks)
			assert.Zero(t, it.GridChecks)
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

func TestAdminListSessionsHandler_ExposesClientKeysUnlikePublicResponse(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)
	startSessionT(t, svc, models.GameDifficultyEasy)

	rec := doAdmin(t, e, http.MethodGet, "/api/admin/games/sessions")
	require.Equal(t, http.StatusOK, rec.Code)

	// The admin item carries ip_address and user_agent keys (the public
	// GameSessionResponse hides them). Decode the raw item to assert the keys are
	// present, not just the typed values.
	var resp struct {
		Items []map[string]json.RawMessage `json:"items"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Len(t, resp.Items, 1)
	assert.Contains(t, resp.Items[0], "ip_address", "the admin view intentionally exposes ip_address")
	assert.Contains(t, resp.Items[0], "user_agent", "the admin view intentionally exposes user_agent")
	assert.Contains(t, resp.Items[0], "on_leaderboard")
	assert.Contains(t, resp.Items[0], "hidden_at")
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

func TestAdminHideSessionHandler_Returns204AndRetainsRow(t *testing.T) {
	svc, _, db := newServices(t)
	e := newAdminGamesEcho(t, svc)
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)

	rec := doAdmin(t, e, http.MethodPost, "/api/admin/games/sessions/"+session.ID+"/hide")
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Empty(t, rec.Body.Bytes(), "a 204 carries no body")

	row := sessionRow(t, db, session.ID)
	assert.False(t, row.OnLeaderboard)
	require.NotNil(t, row.HiddenAt)
	require.NotNil(t, row.DisplayName)
	assert.Equal(t, "Alice", *row.DisplayName)
}

func TestAdminHideSessionHandler_UnknownIDIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	// A well-formed but unknown id is a 404 from the update (0 rows affected).
	rec := doAdmin(t, e, http.MethodPost, "/api/admin/games/sessions/00000000-0000-0000-0000-000000000000/hide")
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errCodeOf(t, rec))
}

func TestAdminHideSessionHandler_MalformedIDIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	// A malformed id can never name a row, so pathID makes it a 404 before any
	// query rather than a 500 from a failing uuid cast.
	rec := doAdmin(t, e, http.MethodPost, "/api/admin/games/sessions/not-a-uuid/hide")
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errCodeOf(t, rec))
}

func TestAdminUnhideSessionHandler_Returns204AndRestoresRow(t *testing.T) {
	svc, _, db := newServices(t)
	e := newAdminGamesEcho(t, svc)
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)
	require.NoError(t, svc.HideSession(ctx(), session.ID))

	rec := doAdmin(t, e, http.MethodPost, "/api/admin/games/sessions/"+session.ID+"/unhide")
	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Empty(t, rec.Body.Bytes(), "a 204 carries no body")

	row := sessionRow(t, db, session.ID)
	assert.True(t, row.OnLeaderboard)
	assert.Nil(t, row.HiddenAt)
	require.NotNil(t, row.DisplayName)
	assert.Equal(t, "Alice", *row.DisplayName)
}

func TestAdminUnhideSessionHandler_UnknownIDIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	rec := doAdmin(t, e, http.MethodPost, "/api/admin/games/sessions/00000000-0000-0000-0000-000000000000/unhide")
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errCodeOf(t, rec))
}

func TestAdminUnhideSessionHandler_MalformedIDIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	rec := doAdmin(t, e, http.MethodPost, "/api/admin/games/sessions/not-a-uuid/unhide")
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errCodeOf(t, rec))
}

func TestAdminRenameSessionHandler_Returns204AndRenames(t *testing.T) {
	svc, _, db := newServices(t)
	e := newAdminGamesEcho(t, svc)
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)

	// The name is trimmed by the binder before storage.
	rec := postAdminJSON(t, e, "/api/admin/games/sessions/"+session.ID+"/rename", `{"display_name":"  Alicia  "}`)
	assert.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Empty(t, rec.Body.Bytes(), "a 204 carries no body")

	row := sessionRow(t, db, session.ID)
	require.NotNil(t, row.DisplayName)
	assert.Equal(t, "Alicia", *row.DisplayName)
	assert.True(t, row.OnLeaderboard)
	assert.EqualValues(t, 30000, row.ElapsedMS)
}

func TestAdminRenameSessionHandler_RejectsBadPayloads(t *testing.T) {
	svc, _, db := newServices(t)
	e := newAdminGamesEcho(t, svc)
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)
	path := "/api/admin/games/sessions/" + session.ID + "/rename"

	for name, tc := range map[string]struct {
		body string
		code errcodes.Code
	}{
		"blank name":    {`{"display_name":"   "}`, errcodes.CodeValidationError},
		"too long":      {`{"display_name":"` + strings.Repeat("a", 51) + `"}`, errcodes.CodeValidationError},
		"time included": {`{"display_name":"Bob","elapsed_ms":1}`, errcodes.CodeUnknownParameter},
	} {
		t.Run(name, func(t *testing.T) {
			rec := postAdminJSON(t, e, path, tc.body)
			assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, rec.Body.String())
			assert.Equal(t, string(tc.code), errCodeOf(t, rec))
		})
	}
	row := sessionRow(t, db, session.ID)
	assert.Equal(t, "Alice", *row.DisplayName)
	assert.EqualValues(t, 30000, row.ElapsedMS)
}

func TestAdminRenameSessionHandler_UnpostedSolveIs422(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)
	session := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)

	rec := postAdminJSON(t, e, "/api/admin/games/sessions/"+session.ID+"/rename", `{"display_name":"Alice"}`)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errCodeOf(t, rec))
}

func TestAdminRenameSessionHandler_UnknownAndMalformedIDsAre404(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	for _, id := range []string{"00000000-0000-0000-0000-000000000000", "not-a-uuid"} {
		rec := postAdminJSON(t, e, "/api/admin/games/sessions/"+id+"/rename", `{"display_name":"Alice"}`)
		assert.Equal(t, http.StatusNotFound, rec.Code, id)
		assert.Equal(t, string(errcodes.CodeNotFound), errCodeOf(t, rec), id)
	}
}

func TestAdminSetSessionPartyHandler_Returns204AndSetsThenClears(t *testing.T) {
	svc, partySvc, db := newServices(t)
	e := newAdminGamesEcho(t, svc)
	smiths := createPartyT(t, partySvc, "The Smiths")
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)
	path := "/api/admin/games/sessions/" + session.ID + "/party"

	rec := postAdminJSON(t, e, path, `{"party_id":"`+smiths.ID+`"}`)
	assert.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Empty(t, rec.Body.Bytes(), "a 204 carries no body")
	row := sessionRow(t, db, session.ID)
	require.NotNil(t, row.PartyID)
	assert.Equal(t, smiths.ID, *row.PartyID)

	rec = postAdminJSON(t, e, path, `{"party_id":null}`)
	assert.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Nil(t, sessionRow(t, db, session.ID).PartyID)

	// An omitted key, which is what the frontend sends to clear, also clears.
	require.Equal(t, http.StatusNoContent, postAdminJSON(t, e, path, `{"party_id":"`+smiths.ID+`"}`).Code)
	rec = postAdminJSON(t, e, path, `{}`)
	assert.Equal(t, http.StatusNoContent, rec.Code, rec.Body.String())
	assert.Nil(t, sessionRow(t, db, session.ID).PartyID)
}

func TestAdminSetSessionPartyHandler_RejectsBadPartyIDs(t *testing.T) {
	svc, _, db := newServices(t)
	e := newAdminGamesEcho(t, svc)
	session := postSessionT(t, svc, "Alice", models.GameDifficultyEasy, 30000)
	path := "/api/admin/games/sessions/" + session.ID + "/party"

	for name, body := range map[string]string{
		"malformed": `{"party_id":"not-a-uuid"}`,
		"unknown":   `{"party_id":"00000000-0000-0000-0000-000000000000"}`,
	} {
		t.Run(name, func(t *testing.T) {
			rec := postAdminJSON(t, e, path, body)
			assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, rec.Body.String())
			assert.Equal(t, string(errcodes.CodeValidationError), errCodeOf(t, rec))
		})
	}
	assert.Nil(t, sessionRow(t, db, session.ID).PartyID)
}

func TestAdminSetSessionPartyHandler_UnknownAndMalformedSessionIDsAre404(t *testing.T) {
	svc, _, _ := newServices(t)
	e := newAdminGamesEcho(t, svc)

	for _, id := range []string{"00000000-0000-0000-0000-000000000000", "not-a-uuid"} {
		rec := postAdminJSON(t, e, "/api/admin/games/sessions/"+id+"/party", `{"party_id":null}`)
		assert.Equal(t, http.StatusNotFound, rec.Code, id)
		assert.Equal(t, string(errcodes.CodeNotFound), errCodeOf(t, rec), id)
	}
}
