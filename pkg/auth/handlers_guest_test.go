package auth_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// newGuestAuthEcho builds an Echo instance with the auth routes registered
// against a dedicated Postgres test database (the guest login looks parties up
// by RSVP code), wiring the real binder and error handler like the production
// server. The database is this package's own (NewIsolated) because these tests
// write parties, which the concurrently running pkg/parties binary owns in the
// shared test database. Tests using it must not call t.Parallel().
func newGuestAuthEcho(t *testing.T, rl auth.RateLimit) (*echo.Echo, *auth.Service, *bun.DB) {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_auth_test")
	databasetest.Truncate(t, db, "parties")

	svc := auth.NewService(testSecret, time.Hour, time.Hour, testUsername, testPassword)
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	api := e.Group("/api")
	auth.RegisterRoutes(api, svc, db, rl)
	return e, svc, db
}

// generousRateLimit never throttles within a test, so every test except the
// rate-limit ones observes pure login behavior.
func generousRateLimit() auth.RateLimit {
	return auth.RateLimit{PerMinute: 6000, Burst: 1000}
}

// createPartyWithCode inserts a party fixture with the given RSVP code
// directly (no service dependency keeps pkg/auth's import graph clean).
func createPartyWithCode(t *testing.T, db *bun.DB, code string) *models.Party {
	t.Helper()
	party := &models.Party{
		ID:             uuid.Must(uuid.NewV7()).String(),
		Name:           "The Smiths",
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		InvitationType: models.InvitationDigital,
		InfoToken:      uuid.Must(uuid.NewV7()).String(),
		RSVPCode:       pointerutil.String(code),
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	_, err := db.NewInsert().Model(party).Exec(context.Background())
	require.NoError(t, err)
	return party
}

func postGuestLogin(t *testing.T, e *echo.Echo, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/api/auth/guest/login", strings.NewReader(body))
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestGuestLogin_ReturnsTokenForValidCode(t *testing.T) {
	e, svc, db := newGuestAuthEcho(t, generousRateLimit())
	party := createPartyWithCode(t, db, "KALEL")

	rec := postGuestLogin(t, e, `{"code":"KALEL"}`)
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.NotEmpty(t, resp.Token)

	// The returned token must be a guest token carrying the party it
	// authenticates.
	claims, err := svc.ValidateToken(resp.Token)
	require.NoError(t, err)
	assert.Equal(t, auth.RoleGuest, claims.Role)
	assert.Equal(t, party.ID, claims.PartyID)
}

func TestGuestLogin_MatchesCodeCaseInsensitively(t *testing.T) {
	e, svc, db := newGuestAuthEcho(t, generousRateLimit())
	party := createPartyWithCode(t, db, "PEPPER")

	// Codes print uppercase on the invitation, but guests type freely.
	rec := postGuestLogin(t, e, `{"code":"  pepper "}`)
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Token string `json:"token"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	claims, err := svc.ValidateToken(resp.Token)
	require.NoError(t, err)
	assert.Equal(t, party.ID, claims.PartyID)
}

func TestGuestLogin_Returns401ForUnknownCode(t *testing.T) {
	e, _, db := newGuestAuthEcho(t, generousRateLimit())
	createPartyWithCode(t, db, "KALEL")

	rec := postGuestLogin(t, e, `{"code":"WRONGX"}`)
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestGuestLogin_Returns422ForMissingCode(t *testing.T) {
	e, _, _ := newGuestAuthEcho(t, generousRateLimit())

	rec := postGuestLogin(t, e, `{}`)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestLoginRateLimit_SharedAcrossBothLoginEndpoints(t *testing.T) {
	// Burst 2 with a negligible refill: the third rapid attempt from one IP must
	// be throttled, and the budget must be shared between the guest and admin
	// login endpoints (one limiter, ADR 0006).
	e, _, db := newGuestAuthEcho(t, auth.RateLimit{PerMinute: 0.0001, Burst: 2})
	createPartyWithCode(t, db, "KALEL")

	rec := postGuestLogin(t, e, `{"code":"KALEL"}`)
	require.Equal(t, http.StatusOK, rec.Code)
	rec = postGuestLogin(t, e, `{"code":"WRONGX"}`)
	require.Equal(t, http.StatusUnauthorized, rec.Code)

	// Budget exhausted: the guest endpoint throttles...
	rec = postGuestLogin(t, e, `{"code":"KALEL"}`)
	require.Equal(t, http.StatusTooManyRequests, rec.Code)

	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, string(errcodes.CodeTooManyRequests), body.Error.Code)

	// ...and so does the admin endpoint, because the two share one store.
	rec = postLogin(t, e, `{"username":"admin","password":"correct-horse"}`)
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
}

func TestLoginRateLimit_ValidCredentialsStillWorkWithinBudget(t *testing.T) {
	// A small burst absorbs a fumbled code: a wrong attempt followed by the
	// right one both fit inside the budget.
	e, _, db := newGuestAuthEcho(t, auth.RateLimit{PerMinute: 5, Burst: 5})
	createPartyWithCode(t, db, "KALEL")

	rec := postGuestLogin(t, e, `{"code":"TYPOED"}`)
	require.Equal(t, http.StatusUnauthorized, rec.Code)
	rec = postGuestLogin(t, e, `{"code":"KALEL"}`)
	assert.Equal(t, http.StatusOK, rec.Code)
}
