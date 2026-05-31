package auth_test

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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

// newAuthEcho builds an Echo instance with the auth routes registered against a
// service holding a known admin credential.
func newAuthEcho(t *testing.T) (*echo.Echo, *auth.Service) {
	t.Helper()
	hash, err := bcrypt.GenerateFromPassword([]byte(testPassword), bcrypt.MinCost)
	require.NoError(t, err)
	svc := auth.NewService(testSecret, time.Hour, testUsername, string(hash))

	e := echo.New()
	api := e.Group("/api")
	auth.RegisterRoutes(api, svc)
	return e, svc
}

func postLogin(t *testing.T, e *echo.Echo, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/admin/login", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestAdminLogin_ReturnsTokenForValidCredentials(t *testing.T) {
	t.Parallel()
	e, svc := newAuthEcho(t)

	rec := postLogin(t, e, `{"username":"admin","password":"correct-horse"}`)
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.NotEmpty(t, resp.Token)

	// The returned token must be a valid admin token.
	claims, err := svc.ValidateToken(resp.Token)
	require.NoError(t, err)
	assert.Equal(t, auth.RoleAdmin, claims.Role)
}

func TestAdminLogin_Returns401ForWrongPassword(t *testing.T) {
	t.Parallel()
	e, _ := newAuthEcho(t)

	rec := postLogin(t, e, `{"username":"admin","password":"nope"}`)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestAdminLogin_Returns401ForWrongUsername(t *testing.T) {
	t.Parallel()
	e, _ := newAuthEcho(t)

	rec := postLogin(t, e, `{"username":"intruder","password":"correct-horse"}`)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestAdminLogin_Returns400ForMalformedBody(t *testing.T) {
	t.Parallel()
	e, _ := newAuthEcho(t)

	rec := postLogin(t, e, `{not json`)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}
