package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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

func TestGuestRoute_RequiresGuestToken(t *testing.T) {
	srv := server.New(newTestConfig(t), nil)

	// Without a token the guest RSVP route is rejected, proving the rsvps
	// routes mounted behind the guest middleware, not beside it.
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/guest/rsvp", http.NoBody)
	rec := httptest.NewRecorder()
	srv.Handler.ServeHTTP(rec, req)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
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
