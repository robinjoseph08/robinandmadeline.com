package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// runRequireAdmin runs the RequireAdmin middleware against a request carrying
// the given Authorization header, reporting whether the wrapped handler ran and
// the resulting HTTP status.
func runRequireAdmin(t *testing.T, svc *auth.Service, authHeader string) (nextCalled bool, status int) {
	t.Helper()

	e := echo.New()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/admin/dashboard", http.NoBody)
	if authHeader != "" {
		req.Header.Set(echo.HeaderAuthorization, authHeader)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	mw := auth.NewMiddleware(svc)
	handler := mw.RequireAdmin(func(c echo.Context) error {
		nextCalled = true
		return c.NoContent(http.StatusOK)
	})

	err := handler(c)
	if err != nil {
		// Mirror Echo's default error handling so we observe a status code.
		e.HTTPErrorHandler(err, c)
	}
	return nextCalled, rec.Code
}

func TestRequireAdmin_AllowsValidAdminToken(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	token, err := svc.GenerateAdminToken()
	require.NoError(t, err)

	called, status := runRequireAdmin(t, svc, "Bearer "+token)
	assert.True(t, called)
	assert.Equal(t, http.StatusOK, status)
}

func TestRequireAdmin_BlocksMissingHeader(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)

	called, status := runRequireAdmin(t, svc, "")
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestRequireAdmin_BlocksMalformedHeader(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	token, err := svc.GenerateAdminToken()
	require.NoError(t, err)

	// Missing the "Bearer " scheme prefix.
	called, status := runRequireAdmin(t, svc, token)
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestRequireAdmin_BlocksInvalidToken(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)

	called, status := runRequireAdmin(t, svc, "Bearer not-a-real-jwt")
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestRequireAdmin_BlocksGuestRole(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	// A valid token, but for the guest role: admin routes must still reject it.
	token, err := svc.GenerateGuestToken("0190b8e0-0000-7000-8000-000000000001")
	require.NoError(t, err)

	called, status := runRequireAdmin(t, svc, "Bearer "+token)
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestRequireAdmin_BlocksExpiredToken(t *testing.T) {
	t.Parallel()
	// A service with a negative admin duration mints an already-expired token.
	svc := auth.NewService(testSecret, -time.Hour, time.Hour, testUsername, "")
	token, err := svc.GenerateAdminToken()
	require.NoError(t, err)

	// Validate against a service with the same secret but positive duration so
	// only the embedded expiry (in the past) drives rejection.
	verifier := auth.NewService(testSecret, time.Hour, time.Hour, testUsername, "")
	called, status := runRequireAdmin(t, verifier, "Bearer "+token)
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}
