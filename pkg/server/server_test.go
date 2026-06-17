package server_test

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/server"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newTestConfig builds a Config with a known admin credential for wiring
// tests. The login rate limit is generous so these tests observe pure auth
// behavior (the limiter itself is covered in pkg/auth).
func newTestConfig(t *testing.T) *config.Config {
	t.Helper()
	return &config.Config{
		ServerPort:           0,
		AdminUsername:        "admin",
		AdminPassword:        "correct-horse",
		JWTSecret:            "test-secret",
		AdminSessionDuration: time.Hour,
		GuestSessionDuration: time.Hour,
		LoginRatePerMinute:   6000,
		LoginRateBurst:       1000,
	}
}

func TestAdminLoginRoute_Wired(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	body := `{"username":"admin","password":"correct-horse"}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/admin/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.NotEmpty(t, resp.Token)
}

func TestAdminLoginRoute_RejectsBadCredentials(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	body := `{"username":"admin","password":"wrong"}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/admin/login", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestProtectedAdminRoute_RequiresToken(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	// Without a token the protected admin route is rejected.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/admin/me", http.NoBody)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)

	// The parties routes hang off the same protected group, so they reject a
	// tokenless request too (proving RegisterRoutes mounted them behind the
	// middleware, not beside it).
	partiesReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/admin/parties", http.NoBody)
	partiesRec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(partiesRec, partiesReq)
	require.Equal(t, http.StatusUnauthorized, partiesRec.Code)

	// Same for the photo-groups routes.
	photoGroupsReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/admin/photo-groups", http.NoBody)
	photoGroupsRec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(photoGroupsRec, photoGroupsReq)
	require.Equal(t, http.StatusUnauthorized, photoGroupsRec.Code)

	// Same for the emails routes.
	emailsReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/admin/emails/templates", http.NoBody)
	emailsRec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(emailsRec, emailsReq)
	require.Equal(t, http.StatusUnauthorized, emailsRec.Code)

	// Logging in then presenting the token grants access.
	loginBody := `{"username":"admin","password":"correct-horse"}`
	loginReq := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/admin/login", strings.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(loginRec, loginReq)
	require.Equal(t, http.StatusOK, loginRec.Code)

	var resp struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.Unmarshal(loginRec.Body.Bytes(), &resp))

	authedReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/admin/me", http.NoBody)
	authedReq.Header.Set("Authorization", "Bearer "+resp.Token)
	authedRec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(authedRec, authedReq)
	assert.Equal(t, http.StatusOK, authedRec.Code)
}

func TestGamesAdminRoutes_RequireToken(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	// The games admin routes hang off the same protected group, so a tokenless
	// request to either is a 401 (proving RegisterAdminRoutes mounted them
	// behind the middleware, not beside it). A 401 here, before any handler
	// runs, also keeps this wiring test db-free; the list/delete behavior is
	// covered in pkg/games.
	listReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/admin/games/sessions", http.NoBody)
	listRec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(listRec, listReq)
	require.Equal(t, http.StatusUnauthorized, listRec.Code)

	deleteReq := httptest.NewRequestWithContext(context.Background(), http.MethodDelete, "/api/admin/games/sessions/00000000-0000-0000-0000-000000000000", http.NoBody)
	deleteRec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(deleteRec, deleteReq)
	require.Equal(t, http.StatusUnauthorized, deleteRec.Code)
}

func TestGuestRoute_RequiresGuestToken(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	// Without a token the guest RSVP route is rejected, proving the rsvps
	// routes mounted behind the guest middleware, not beside it.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/guest/rsvp", http.NoBody)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)

	// Same for the guest-facing photo-groups route.
	photoGroupsReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/guest/photo-groups", http.NoBody)
	photoGroupsRec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(photoGroupsRec, photoGroupsReq)
	require.Equal(t, http.StatusUnauthorized, photoGroupsRec.Code)
}

func TestScheduleRoute_WiredBehindOptionalGuestAuth(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	// An invalid bearer token is rejected by the optional-guest middleware
	// (401, not 404), which both proves GET /api/events is mounted behind it
	// and keeps this wiring test db-free (schedule behavior is covered in
	// pkg/events).
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/events", http.NoBody)
	req.Header.Set("Authorization", "Bearer not-a-real-jwt")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestGamesRoutes_Wired(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	// An invalid bearer token is rejected by the optional-guest middleware
	// (401, not 404), which both proves POST /api/games/sessions is mounted
	// behind it and keeps this wiring test db-free (games behavior is covered
	// in pkg/games).
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/games/sessions", strings.NewReader(`{"puzzle_id":"wedding-mini-v1","difficulty":"easy"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer not-a-real-jwt")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)

	// A missing puzzle_id is rejected by the binder (422) before any database
	// access, proving the public leaderboard read is mounted too.
	boardReq := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/games/leaderboard", http.NoBody)
	boardRec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(boardRec, boardReq)
	require.Equal(t, http.StatusUnprocessableEntity, boardRec.Code)
}

func TestGuestLoginRoute_Wired(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	// A missing code is rejected by the binder (422) before any database
	// access, which both proves the route is mounted and keeps this wiring test
	// db-free (full guest login behavior is covered in pkg/auth).
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/guest/login", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestMailgunWebhookRoute_WiredOnOpenGroup(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	// No JWT is attached: the webhook lives on the open group (Mailgun is the
	// caller). The test config has no signing key, so the signature check
	// rejects the payload with 401, which both proves the route is mounted
	// outside the admin middleware and that unsigned payloads cannot get in
	// (full webhook behavior is covered in pkg/emails).
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/webhooks/mailgun", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestMailgunWebhookRoute_SignedPayloadPassesWithoutJWT(t *testing.T) {
	// The 401 above could also come from the admin middleware; this proves it
	// is the signature gate by getting a correctly signed payload through with
	// no JWT at all. The event is untracked ("opened"), so the handler ACKs it
	// before touching the database and the test stays db-free; with the
	// signing key configured, the webhook's own config plumbing is observed
	// too.
	cfg := newTestConfig(t)
	cfg.MailgunWebhookSigningKey = "server-test-signing-key"
	srv := server.New(cfg, nil)

	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	const token = "token-abc"
	mac := hmac.New(sha256.New, []byte(cfg.MailgunWebhookSigningKey))
	mac.Write([]byte(timestamp + token))
	body := fmt.Sprintf(
		`{"signature":{"timestamp":%q,"token":%q,"signature":%q},"event-data":{"event":"opened"}}`,
		timestamp, token, hex.EncodeToString(mac.Sum(nil)),
	)

	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/webhooks/mailgun", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusNoContent, rec.Code)
}

func TestSendTestRoute_TestSendWiredWhenMailgunConfigured(t *testing.T) {
	// server.New enables the "Send test" capability (WithTestSend) only when
	// MailgunAPIKey is set. With it (and test recipients) configured, a POST to
	// the test endpoint must get PAST the capability gate, proving that wiring is
	// in place; deleting the WithTestSend line would instead make every
	// production test-send 422 "Email sending is not configured." with no failing
	// test. The db is nil here, so the request fails later (the capability gate is
	// reached before any DB access), which is fine: this asserts specifically
	// that it is NOT the not-configured 422.
	cfg := newTestConfig(t)
	cfg.MailgunAPIKey = "key-server-test"
	cfg.EmailTestRecipients = []string{"robin@example.com"}
	srv := server.New(cfg, nil)

	// Log in for a valid admin token (the endpoint is behind RequireAdmin).
	loginBody := `{"username":"admin","password":"correct-horse"}`
	loginReq := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/admin/login", strings.NewReader(loginBody))
	loginReq.Header.Set("Content-Type", "application/json")
	loginRec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(loginRec, loginReq)
	require.Equal(t, http.StatusOK, loginRec.Code)

	var login struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.Unmarshal(loginRec.Body.Bytes(), &login))
	require.NotEmpty(t, login.Token)

	// A valid draft: the body passes the binder so the request reaches the
	// service's capability gate rather than 422-ing on validation first.
	testBody := `{"subject":"Hi {{guest_name}}","body":"Body","filter":{}}`
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/admin/emails/test", strings.NewReader(testBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+login.Token)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)

	// It must not be rejected by the capability gate. The gate's distinctive 422
	// message proves the capability is off; its absence proves WithTestSend ran.
	var resp struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)
	assert.NotEqual(t, "Email sending is not configured.", resp.Error.Message,
		"test-send capability gate rejected the request; WithTestSend wiring is missing")
	// The request got past the gate into DB-backed work, which with a nil db
	// surfaces as a 500, not the gate's 422.
	assert.NotEqual(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestHealthEndpoint(t *testing.T) {
	tests := []struct {
		name          string
		wantStatus    int
		wantStatusVal string
		wantDatabase  string
	}{
		{
			name:          "returns 200 with ok status when db is nil",
			wantStatus:    http.StatusOK,
			wantStatusVal: "ok",
			wantDatabase:  "unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// db is nil: the health endpoint must still be reachable and 200.
			srv := server.New(&config.Config{ServerPort: 0}, nil)

			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/health", http.NoBody)
			rec := httptest.NewRecorder()
			srv.Handler.ServeHTTP(rec, req)

			assert.Equal(t, tt.wantStatus, rec.Code)
			assert.Equal(t, "application/json", rec.Header().Get("Content-Type"))

			var body struct {
				Status   string `json:"status"`
				Database string `json:"database"`
			}
			require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
			assert.Equal(t, tt.wantStatusVal, body.Status)
			assert.Equal(t, tt.wantDatabase, body.Database)
		})
	}
}
