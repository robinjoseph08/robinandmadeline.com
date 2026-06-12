package games_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/games"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newGamesEcho builds an Echo instance mirroring the production wiring of the
// games surface: the custom binder, the shared error handler, and the games
// routes mounted on the open /api group behind the OptionalGuest middleware,
// so these tests prove the handlers, middleware, and binder cooperate over
// real HTTP semantics.
func newGamesEcho(t *testing.T, svc *games.Service) (*echo.Echo, *auth.Service) {
	t.Helper()
	authSvc := auth.NewService("test-secret", time.Hour, time.Hour, "admin", "password")

	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle

	games.RegisterRoutes(e.Group("/api"), auth.NewMiddleware(authSvc), svc)
	return e, authSvc
}

// gamesRequest describes one request to the games surface; zero values mean
// "not sent".
type gamesRequest struct {
	method  string
	path    string
	body    string
	token   string
	headers map[string]string
}

func doGamesRequest(t *testing.T, e *echo.Echo, r gamesRequest) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), r.method, r.path, strings.NewReader(r.body))
	if r.body != "" {
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	}
	if r.token != "" {
		req.Header.Set(echo.HeaderAuthorization, "Bearer "+r.token)
	}
	for k, v := range r.headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// createSessionHTTP posts a session through the HTTP surface and returns the
// decoded response.
func createSessionHTTP(t *testing.T, e *echo.Echo, token string, headers map[string]string) games.GameSessionResponse {
	t.Helper()
	rec := doGamesRequest(t, e, gamesRequest{
		method:  http.MethodPost,
		path:    "/api/games/sessions",
		body:    `{"puzzle_id":"wedding-mini-v1","difficulty":"medium"}`,
		token:   token,
		headers: headers,
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var resp games.GameSessionResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	return resp
}

// errCodeOf extracts the machine code from an error envelope body.
func errCodeOf(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var envelope errcodes.ErrorEnvelope
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	return envelope.Error.Code
}

func TestPostGameSession_AnonymousCreates201WithNullParty(t *testing.T) {
	svc, _, db := newServices(t)
	e, _ := newGamesEcho(t, svc)

	resp := createSessionHTTP(t, e, "", nil)
	assert.NotEmpty(t, resp.ID)
	assert.Equal(t, "wedding-mini-v1", resp.PuzzleID)
	assert.Equal(t, models.GameDifficultyMedium, resp.Difficulty)
	assert.Nil(t, resp.PartyID)
	assert.Nil(t, resp.CompletedAt)
	assert.NotEmpty(t, sessionRow(t, db, resp.ID).IPAddress, "the IP is captured server-side")

	// The IP is stored but never serialized: a session response carries no
	// ip_address key (the model field is json:"-").
	asMap := make(map[string]json.RawMessage)
	rec := doGamesRequest(t, e, gamesRequest{
		method: http.MethodPost,
		path:   "/api/games/sessions",
		body:   `{"puzzle_id":"wedding-mini-v1","difficulty":"medium"}`,
	})
	require.Equal(t, http.StatusCreated, rec.Code)
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &asMap))
	assert.NotContains(t, asMap, "ip_address")
}

func TestPostGameSession_ValidGuestTokenAttachesParty(t *testing.T) {
	svc, partySvc, _ := newServices(t)
	e, authSvc := newGamesEcho(t, svc)
	p := createPartyT(t, partySvc, "The Smiths")
	token, err := authSvc.GenerateGuestToken(p.ID)
	require.NoError(t, err)

	resp := createSessionHTTP(t, e, token, nil)
	require.NotNil(t, resp.PartyID)
	assert.Equal(t, p.ID, *resp.PartyID)
}

func TestPostGameSession_DeletedPartyTokenCreatesAnonymousSession(t *testing.T) {
	svc, partySvc, db := newServices(t)
	e, authSvc := newGamesEcho(t, svc)
	p := createPartyT(t, partySvc, "The Smiths")
	token, err := authSvc.GenerateGuestToken(p.ID)
	require.NoError(t, err)
	// The party vanishes (a guest re-import or an admin delete) while the
	// token, valid for months, lives on in the guest's browser. The token is
	// still cryptographically valid, so the request passes OptionalGuest; the
	// stale claim must then degrade to an anonymous session instead of failing
	// the party FK with a 500.
	require.NoError(t, partySvc.DeleteParty(ctx(), p.ID))

	resp := createSessionHTTP(t, e, token, nil)
	assert.Nil(t, sessionRow(t, db, resp.ID).PartyID, "the stale claim degrades to an anonymous session")
}

func TestPostGameSession_InvalidTokenIs401(t *testing.T) {
	// OptionalGuest lets tokenless requests through but rejects a presented
	// bad credential, so a stale stored token surfaces instead of silently
	// downgrading to an anonymous session.
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)

	rec := doGamesRequest(t, e, gamesRequest{
		method: http.MethodPost,
		path:   "/api/games/sessions",
		body:   `{"puzzle_id":"wedding-mini-v1","difficulty":"easy"}`,
		token:  "not-a-real-token",
	})
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestPostGameSession_BinderRejectsBadPayloads(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)

	for name, body := range map[string]string{
		"missing puzzle_id":     `{"difficulty":"easy"}`,
		"blank puzzle_id":       `{"puzzle_id":"   ","difficulty":"easy"}`,
		"missing difficulty":    `{"puzzle_id":"wedding-mini-v1"}`,
		"unknown difficulty":    `{"puzzle_id":"wedding-mini-v1","difficulty":"brutal"}`,
		"overlong puzzle_id":    `{"puzzle_id":"` + strings.Repeat("x", 101) + `","difficulty":"easy"}`,
		"unknown parameter":     `{"puzzle_id":"wedding-mini-v1","difficulty":"easy","speed":"fast"}`,
		"wrong difficulty type": `{"puzzle_id":"wedding-mini-v1","difficulty":3}`,
	} {
		rec := doGamesRequest(t, e, gamesRequest{method: http.MethodPost, path: "/api/games/sessions", body: body})
		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, "%s: %s", name, rec.Body.String())
	}
}

func TestPostGameSession_CapturesFlyClientIPFirst(t *testing.T) {
	svc, _, db := newServices(t)
	e, _ := newGamesEcho(t, svc)

	// Fly's proxy header wins over X-Forwarded-For when both are present.
	resp := createSessionHTTP(t, e, "", map[string]string{
		"Fly-Client-IP":   "198.51.100.9",
		"X-Forwarded-For": "203.0.113.50",
	})
	assert.Equal(t, "198.51.100.9", sessionRow(t, db, resp.ID).IPAddress)

	// Without the Fly header, the standard forwarded header is used.
	resp = createSessionHTTP(t, e, "", map[string]string{
		"X-Forwarded-For": "203.0.113.50",
	})
	assert.Equal(t, "203.0.113.50", sessionRow(t, db, resp.ID).IPAddress)

	// With neither, the socket's remote address is the last resort (httptest
	// stamps 192.0.2.1:1234 on every request).
	resp = createSessionHTTP(t, e, "", nil)
	assert.Equal(t, "192.0.2.1", sessionRow(t, db, resp.ID).IPAddress)

	// Anywhere the app is reached without Fly's proxy the headers are
	// client-controlled text, so a Fly header that does not parse as an IP is
	// skipped, never stored.
	resp = createSessionHTTP(t, e, "", map[string]string{
		"Fly-Client-IP":   "not-an-ip",
		"X-Forwarded-For": "203.0.113.50",
	})
	assert.Equal(t, "203.0.113.50", sessionRow(t, db, resp.ID).IPAddress)

	// Garbage in both headers falls back to the socket's address rather than
	// persisting attacker-chosen text as the "IP".
	resp = createSessionHTTP(t, e, "", map[string]string{
		"Fly-Client-IP":   "not-an-ip",
		"X-Forwarded-For": "also-not-an-ip",
	})
	assert.Equal(t, "192.0.2.1", sessionRow(t, db, resp.ID).IPAddress)
}

func TestPatchGameSession_UpdatesAndCompletes(t *testing.T) {
	svc, _, db := newServices(t)
	e, _ := newGamesEcho(t, svc)
	created := createSessionHTTP(t, e, "", nil)

	rec := doGamesRequest(t, e, gamesRequest{
		method: http.MethodPatch,
		path:   "/api/games/sessions/" + created.ID,
		body:   `{"elapsed_ms":15000,"difficulty":"easy"}`,
	})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var resp games.GameSessionResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.EqualValues(t, 15000, resp.ElapsedMS)
	assert.Equal(t, models.GameDifficultyEasy, resp.Difficulty, "the easiest difficulty seen sticks")

	rec = doGamesRequest(t, e, gamesRequest{
		method: http.MethodPatch,
		path:   "/api/games/sessions/" + created.ID,
		body:   `{"elapsed_ms":42000,"completed":true}`,
	})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.NotNil(t, resp.CompletedAt)
	require.NotNil(t, sessionRow(t, db, created.ID).CompletedAt)
}

func TestPatchGameSession_ValidGuestTokenAttachesParty(t *testing.T) {
	svc, partySvc, db := newServices(t)
	e, authSvc := newGamesEcho(t, svc)
	p := createPartyT(t, partySvc, "The Smiths")
	token, err := authSvc.GenerateGuestToken(p.ID)
	require.NoError(t, err)
	created := createSessionHTTP(t, e, "", nil)

	// The guest signed in mid-solve: a report carrying their token affiliates
	// the previously anonymous session, proving OptionalGuest feeds the PATCH
	// handler over real HTTP, not just the service call.
	rec := doGamesRequest(t, e, gamesRequest{
		method: http.MethodPatch,
		path:   "/api/games/sessions/" + created.ID,
		body:   `{"elapsed_ms":1000}`,
		token:  token,
	})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	row := sessionRow(t, db, created.ID)
	require.NotNil(t, row.PartyID)
	assert.Equal(t, p.ID, *row.PartyID)
}

func TestPatchGameSession_InvalidTokenIs401(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)
	created := createSessionHTTP(t, e, "", nil)

	// As on create, OptionalGuest rejects a presented-but-invalid credential
	// instead of silently downgrading the report to anonymous.
	rec := doGamesRequest(t, e, gamesRequest{
		method: http.MethodPatch,
		path:   "/api/games/sessions/" + created.ID,
		body:   `{"elapsed_ms":1000}`,
		token:  "not-a-real-token",
	})
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestPatchGameSession_BinderAndGuardFailures(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)
	created := createSessionHTTP(t, e, "", nil)
	path := "/api/games/sessions/" + created.ID

	// Binder failures: elapsed_ms is required (omitted and null are 422, so an
	// accidental zero can never read as a decrease), bounded, and typed.
	for name, body := range map[string]string{
		"missing elapsed_ms":  `{"difficulty":"easy"}`,
		"null elapsed_ms":     `{"elapsed_ms":null}`,
		"negative elapsed_ms": `{"elapsed_ms":-1}`,
		"absurd elapsed_ms":   `{"elapsed_ms":86400001}`,
		"bad difficulty":      `{"elapsed_ms":1000,"difficulty":"brutal"}`,
	} {
		rec := doGamesRequest(t, e, gamesRequest{method: http.MethodPatch, path: path, body: body})
		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, "%s: %s", name, rec.Body.String())
	}

	// A decreasing total is a 422 from the service guard.
	rec := doGamesRequest(t, e, gamesRequest{method: http.MethodPatch, path: path, body: `{"elapsed_ms":5000}`})
	require.Equal(t, http.StatusOK, rec.Code)
	rec = doGamesRequest(t, e, gamesRequest{method: http.MethodPatch, path: path, body: `{"elapsed_ms":4000}`})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errCodeOf(t, rec))

	// A malformed session id can never name a row: 404 before any query.
	rec = doGamesRequest(t, e, gamesRequest{method: http.MethodPatch, path: "/api/games/sessions/not-a-uuid", body: `{"elapsed_ms":1}`})
	assert.Equal(t, http.StatusNotFound, rec.Code)

	// An unknown (but well-formed) id is a 404 from the lookup, so one session
	// cannot address another without holding its exact id.
	rec = doGamesRequest(t, e, gamesRequest{method: http.MethodPatch, path: "/api/games/sessions/00000000-0000-0000-0000-000000000000", body: `{"elapsed_ms":1}`})
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestPatchGameSession_CompletedSessionConflictsOverHTTP(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)
	created := createSessionHTTP(t, e, "", nil)
	path := "/api/games/sessions/" + created.ID

	rec := doGamesRequest(t, e, gamesRequest{method: http.MethodPatch, path: path, body: `{"elapsed_ms":9000,"completed":true}`})
	require.Equal(t, http.StatusOK, rec.Code)

	// The exact final report replays as a no-op success (a client retry)...
	rec = doGamesRequest(t, e, gamesRequest{method: http.MethodPatch, path: path, body: `{"elapsed_ms":9000,"completed":true}`})
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// ...but any change attempt is a 409.
	rec = doGamesRequest(t, e, gamesRequest{method: http.MethodPatch, path: path, body: `{"elapsed_ms":9001,"completed":true}`})
	assert.Equal(t, http.StatusConflict, rec.Code)
	assert.Equal(t, string(errcodes.CodeConflict), errCodeOf(t, rec))
}

func TestPostLeaderboard_FullFlowOverHTTP(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)
	created := createSessionHTTP(t, e, "", nil)
	sessionPath := "/api/games/sessions/" + created.ID

	// Posting before completion is a 422.
	rec := doGamesRequest(t, e, gamesRequest{method: http.MethodPost, path: sessionPath + "/leaderboard", body: `{"display_name":"Alice"}`})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)

	rec = doGamesRequest(t, e, gamesRequest{method: http.MethodPatch, path: sessionPath, body: `{"elapsed_ms":33000,"completed":true}`})
	require.Equal(t, http.StatusOK, rec.Code)

	// The display name is trimmed by the binder before storage.
	rec = doGamesRequest(t, e, gamesRequest{method: http.MethodPost, path: sessionPath + "/leaderboard", body: `{"display_name":"  Alice  "}`})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var resp games.GameSessionResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.NotNil(t, resp.DisplayName)
	assert.Equal(t, "Alice", *resp.DisplayName)

	// The entry is on the board, and the board never leaks session ids (the
	// id is the session's bearer token).
	rec = doGamesRequest(t, e, gamesRequest{method: http.MethodGet, path: "/api/games/leaderboard?puzzle_id=wedding-mini-v1"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var board struct {
		Items []map[string]json.RawMessage `json:"items"`
		Total int                          `json:"total"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &board))
	assert.Equal(t, 1, board.Total)
	require.Len(t, board.Items, 1)
	assert.NotContains(t, board.Items[0], "id")
	assert.NotContains(t, board.Items[0], "ip_address")
	assert.NotContains(t, board.Items[0], "party_id")
	assert.Contains(t, board.Items[0], "display_name")
	assert.Contains(t, board.Items[0], "difficulty")
	assert.Contains(t, board.Items[0], "elapsed_ms")
	assert.Contains(t, board.Items[0], "completed_at")
}

func TestPostLeaderboard_ValidatesDisplayName(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)
	session := completeSessionT(t, svc, models.GameDifficultyEasy, 5000)
	path := "/api/games/sessions/" + session.ID + "/leaderboard"

	for name, body := range map[string]string{
		"missing name":  `{}`,
		"blank name":    `{"display_name":"   "}`,
		"overlong name": `{"display_name":"` + strings.Repeat("x", 51) + `"}`,
	} {
		rec := doGamesRequest(t, e, gamesRequest{method: http.MethodPost, path: path, body: body})
		assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, "%s: %s", name, rec.Body.String())
	}
}

func TestPostLeaderboard_MalformedIDIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)

	// pathID guards this route the same way it guards the PATCH: a malformed
	// id can never name a row, so it is a 404 before any query.
	rec := doGamesRequest(t, e, gamesRequest{
		method: http.MethodPost,
		path:   "/api/games/sessions/not-a-uuid/leaderboard",
		body:   `{"display_name":"Alice"}`,
	})
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestGamesPayloads_AcceptBoundaryValues(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)

	// The validator maxes are inclusive, so each limit value itself must pass:
	// a puzzle_id of exactly 100 characters is accepted on create...
	rec := doGamesRequest(t, e, gamesRequest{
		method: http.MethodPost,
		path:   "/api/games/sessions",
		body:   `{"puzzle_id":"` + strings.Repeat("x", 100) + `","difficulty":"easy"}`,
	})
	require.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	var created games.GameSessionResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &created))

	// ...an elapsed_ms of exactly the 24-hour cap is accepted on update...
	rec = doGamesRequest(t, e, gamesRequest{
		method: http.MethodPatch,
		path:   "/api/games/sessions/" + created.ID,
		body:   `{"elapsed_ms":86400000,"completed":true}`,
	})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	// ...and a display name of exactly 50 characters is accepted on the post.
	rec = doGamesRequest(t, e, gamesRequest{
		method: http.MethodPost,
		path:   "/api/games/sessions/" + created.ID + "/leaderboard",
		body:   `{"display_name":"` + strings.Repeat("n", 50) + `"}`,
	})
	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

func TestGetLeaderboard_RequiresPuzzleID(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)

	rec := doGamesRequest(t, e, gamesRequest{method: http.MethodGet, path: "/api/games/leaderboard"})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestGetLeaderboard_FiltersByDifficulty(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)

	easy := completeSessionT(t, svc, models.GameDifficultyEasy, 30000)
	_, err := svc.PostToLeaderboard(ctx(), easy.ID, games.PostLeaderboardPayload{DisplayName: "Edna"}, "")
	require.NoError(t, err)
	hard := completeSessionT(t, svc, models.GameDifficultyHard, 20000)
	_, err = svc.PostToLeaderboard(ctx(), hard.ID, games.PostLeaderboardPayload{DisplayName: "Harriet"}, "")
	require.NoError(t, err)

	// The difficulty filter flows through c.Bind's query path: only the easy
	// entry comes back, and total counts the filtered set.
	rec := doGamesRequest(t, e, gamesRequest{method: http.MethodGet, path: "/api/games/leaderboard?puzzle_id=wedding-mini-v1&difficulty=easy"})
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var board games.ListLeaderboardEntriesResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &board))
	assert.Equal(t, 1, board.Total)
	require.Len(t, board.Items, 1)
	assert.Equal(t, "Edna", board.Items[0].DisplayName)
	assert.Equal(t, models.GameDifficultyEasy, board.Items[0].Difficulty)

	// Without the filter the same board returns every difficulty, as before.
	rec = doGamesRequest(t, e, gamesRequest{method: http.MethodGet, path: "/api/games/leaderboard?puzzle_id=wedding-mini-v1"})
	require.Equal(t, http.StatusOK, rec.Code)
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &board))
	assert.Equal(t, 2, board.Total)
	assert.Len(t, board.Items, 2)
}

func TestGetLeaderboard_RejectsUnknownDifficulty(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)

	// Query filters are validated like bodies: an unknown difficulty is a 422
	// from the binder's query path (gorilla/schema decode + validator), never
	// silently ignored as an empty board.
	rec := doGamesRequest(t, e, gamesRequest{method: http.MethodGet, path: "/api/games/leaderboard?puzzle_id=wedding-mini-v1&difficulty=brutal"})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, rec.Body.String())
	assert.Equal(t, string(errcodes.CodeValidationError), errCodeOf(t, rec))
}

func TestGetLeaderboard_RejectsEmptyDifficulty(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)

	// A present-but-empty difficulty binds to a non-nil pointer at "", which
	// fails the oneof like any other garbage value: only a truly ABSENT
	// parameter means the combined board. Pinned so a binder or tag change
	// can't silently turn `difficulty=` into an empty-filter board.
	rec := doGamesRequest(t, e, gamesRequest{method: http.MethodGet, path: "/api/games/leaderboard?puzzle_id=wedding-mini-v1&difficulty="})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code, rec.Body.String())
	assert.Equal(t, string(errcodes.CodeValidationError), errCodeOf(t, rec))
}

func TestGetLeaderboard_EmptyBoardSerializesItemsAsEmptyArray(t *testing.T) {
	svc, _, _ := newServices(t)
	e, _ := newGamesEcho(t, svc)

	rec := doGamesRequest(t, e, gamesRequest{method: http.MethodGet, path: "/api/games/leaderboard?puzzle_id=wedding-mini-v1"})
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"items":[],"total":0}`, rec.Body.String())
}
