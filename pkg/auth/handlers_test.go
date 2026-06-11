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
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAuthEcho builds an Echo instance with the auth routes registered against a
// service holding a known admin credential. It wires the shared errcodes error
// handler AND the custom binder so requests flow through the real
// bind/validate pipeline (required-field checks included), matching the real
// server. The db is nil (the admin login never touches it) and the rate limit
// is generous so these tests observe pure credential behavior.
func newAuthEcho(t *testing.T) (*echo.Echo, *auth.Service) {
	t.Helper()
	svc := auth.NewService(testSecret, time.Hour, time.Hour, testUsername, testPassword)

	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	api := e.Group("/api")
	auth.RegisterRoutes(api, svc, nil, generousRateLimit())
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

func TestAdminLogin_Returns422ForMissingPassword(t *testing.T) {
	t.Parallel()
	e, _ := newAuthEcho(t)

	// password omitted: the binder's required tag rejects it as a 422 before the
	// credential check, so a missing field never reaches the service.
	rec := postLogin(t, e, `{"username":"admin"}`)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)

	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, string(errcodes.CodeValidationError), body.Error.Code)
}
