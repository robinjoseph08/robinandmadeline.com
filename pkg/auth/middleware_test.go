package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// runRequireAdmin runs the RequireAdmin middleware against a request carrying
// the given Authorization header, reporting whether the wrapped handler ran and
// the resulting HTTP status.
func runRequireAdmin(t *testing.T, svc *auth.Service, authHeader string) (nextCalled bool, status int) {
	t.Helper()

	e := echo.New()
	// Wire the shared errcodes handler so middleware errors (now errcodes
	// errors, not *echo.HTTPError) render with their real status, matching the
	// production server.
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
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

// runRequireGuest runs the RequireGuest middleware against a request carrying
// the given Authorization header, reporting whether the wrapped handler ran,
// the party id it observed via PartyIDFromContext, and the HTTP status.
func runRequireGuest(t *testing.T, svc *auth.Service, authHeader string) (nextCalled bool, partyID string, status int) {
	t.Helper()

	e := echo.New()
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/guest/rsvp", http.NoBody)
	if authHeader != "" {
		req.Header.Set(echo.HeaderAuthorization, authHeader)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	mw := auth.NewMiddleware(svc)
	handler := mw.RequireGuest(func(c echo.Context) error {
		nextCalled = true
		id, err := auth.PartyIDFromContext(c)
		if err != nil {
			return err
		}
		partyID = id
		return c.NoContent(http.StatusOK)
	})

	err := handler(c)
	if err != nil {
		e.HTTPErrorHandler(err, c)
	}
	return nextCalled, partyID, rec.Code
}

func TestRequireGuest_AllowsValidGuestTokenAndExposesPartyID(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	const wantPartyID = "0190b8e0-0000-7000-8000-000000000001"
	token, err := svc.GenerateGuestToken(wantPartyID)
	require.NoError(t, err)

	called, partyID, status := runRequireGuest(t, svc, "Bearer "+token)
	assert.True(t, called)
	assert.Equal(t, wantPartyID, partyID)
	assert.Equal(t, http.StatusOK, status)
}

func TestRequireGuest_BlocksMissingHeader(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)

	called, _, status := runRequireGuest(t, svc, "")
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestRequireGuest_BlocksAdminRole(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	// A valid token, but for the admin role: guest routes are scoped to one
	// party, which an admin token does not carry.
	token, err := svc.GenerateAdminToken()
	require.NoError(t, err)

	called, _, status := runRequireGuest(t, svc, "Bearer "+token)
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestRequireGuest_BlocksExpiredToken(t *testing.T) {
	t.Parallel()
	// A service with a negative guest duration mints an already-expired token.
	svc := auth.NewService(testSecret, time.Hour, -time.Hour, testUsername, "")
	token, err := svc.GenerateGuestToken("0190b8e0-0000-7000-8000-000000000001")
	require.NoError(t, err)

	verifier := auth.NewService(testSecret, time.Hour, time.Hour, testUsername, "")
	called, _, status := runRequireGuest(t, verifier, "Bearer "+token)
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}

// runOptionalGuest runs the OptionalGuest middleware against a request
// carrying the given Authorization header, reporting whether the wrapped
// handler ran, the party id it observed via GuestPartyID, and the HTTP status.
func runOptionalGuest(t *testing.T, svc *auth.Service, authHeader string) (nextCalled bool, partyID string, status int) {
	t.Helper()

	e := echo.New()
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/api/events", http.NoBody)
	if authHeader != "" {
		req.Header.Set(echo.HeaderAuthorization, authHeader)
	}
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)

	mw := auth.NewMiddleware(svc)
	handler := mw.OptionalGuest(func(c echo.Context) error {
		nextCalled = true
		partyID = auth.GuestPartyID(c)
		return c.NoContent(http.StatusOK)
	})

	err := handler(c)
	if err != nil {
		e.HTTPErrorHandler(err, c)
	}
	// Every OptionalGuest response, authenticated or not, varies by the
	// Authorization header: a shared cache must never serve one audience's
	// personalized body to another.
	assert.Contains(t, rec.Header().Values("Vary"), echo.HeaderAuthorization)
	return nextCalled, partyID, rec.Code
}

func TestOptionalGuest_AllowsMissingHeaderUnauthenticated(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)

	called, partyID, status := runOptionalGuest(t, svc, "")
	assert.True(t, called)
	assert.Empty(t, partyID)
	assert.Equal(t, http.StatusOK, status)
}

func TestOptionalGuest_AllowsValidGuestTokenAndExposesPartyID(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	const wantPartyID = "0190b8e0-0000-7000-8000-000000000001"
	token, err := svc.GenerateGuestToken(wantPartyID)
	require.NoError(t, err)

	called, partyID, status := runOptionalGuest(t, svc, "Bearer "+token)
	assert.True(t, called)
	assert.Equal(t, wantPartyID, partyID)
	assert.Equal(t, http.StatusOK, status)
}

func TestOptionalGuest_BlocksMalformedHeader(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	token, err := svc.GenerateGuestToken("0190b8e0-0000-7000-8000-000000000001")
	require.NoError(t, err)

	// A present-but-malformed header (missing the "Bearer " scheme prefix) is
	// an offered credential, so it is rejected, not treated as anonymous.
	called, _, status := runOptionalGuest(t, svc, token)
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestOptionalGuest_BlocksInvalidToken(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)

	// A presented credential that fails validation is a 401, never a silent
	// downgrade to the unauthenticated view.
	called, _, status := runOptionalGuest(t, svc, "Bearer not-a-real-jwt")
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestOptionalGuest_BlocksExpiredToken(t *testing.T) {
	t.Parallel()
	// A service with a negative guest duration mints an already-expired token.
	svc := auth.NewService(testSecret, time.Hour, -time.Hour, testUsername, "")
	token, err := svc.GenerateGuestToken("0190b8e0-0000-7000-8000-000000000001")
	require.NoError(t, err)

	verifier := auth.NewService(testSecret, time.Hour, time.Hour, testUsername, "")
	called, _, status := runOptionalGuest(t, verifier, "Bearer "+token)
	assert.False(t, called)
	assert.Equal(t, http.StatusUnauthorized, status)
}

func TestOptionalGuest_BlocksAdminRole(t *testing.T) {
	t.Parallel()
	svc := newTestService(t)
	// A valid token, but for the admin role: the personalized schedule is
	// scoped to one party, which an admin token does not carry.
	token, err := svc.GenerateAdminToken()
	require.NoError(t, err)

	called, _, status := runOptionalGuest(t, svc, "Bearer "+token)
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
