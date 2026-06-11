package rsvps_test

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
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/rsvps"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newGuestEcho builds an Echo instance mirroring the production wiring of the
// guest surface: the custom binder, the shared error handler, and the rsvps
// routes mounted behind the RequireGuest middleware, so these tests prove the
// handlers, middleware, and binder cooperate over real HTTP semantics.
func newGuestEcho(t *testing.T, svc *rsvps.Service) (*echo.Echo, *auth.Service) {
	t.Helper()
	authSvc := auth.NewService("test-secret", time.Hour, time.Hour, "admin", "password")

	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle

	guest := e.Group("/api/guest")
	guest.Use(auth.NewMiddleware(authSvc).RequireGuest)
	rsvps.RegisterRoutes(guest, svc)
	return e, authSvc
}

func doGuestRequest(t *testing.T, e *echo.Echo, method, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, "/api/guest/rsvp", reader)
	if body != "" {
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	}
	if token != "" {
		req.Header.Set(echo.HeaderAuthorization, "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestGuestRSVPEndpoints_RequireGuestToken(t *testing.T) {
	// The middleware rejects these requests before any handler runs, so the
	// service never touches its (nil) database.
	e, authSvc := newGuestEcho(t, rsvps.NewService(nil))

	// No token at all.
	rec := doGuestRequest(t, e, http.MethodGet, "", "")
	assert.Equal(t, http.StatusUnauthorized, rec.Code)

	// A valid admin token is still not a guest token.
	adminToken, err := authSvc.GenerateAdminToken()
	require.NoError(t, err)
	rec = doGuestRequest(t, e, http.MethodGet, adminToken, "")
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestGetGuestRSVP_ReturnsTheTokenPartysData(t *testing.T) {
	svc, partySvc, eventSvc, _ := newServices(t)
	e, authSvc := newGuestEcho(t, svc)

	smiths := createPartyT(t, partySvc, "The Smiths")
	alice := addGuestT(t, partySvc, smiths.ID, "Alice")
	joneses := createPartyT(t, partySvc, "The Joneses")
	addGuestT(t, partySvc, joneses.ID, "Carol")
	createPublicEventT(t, eventSvc)

	token, err := authSvc.GenerateGuestToken(smiths.ID)
	require.NoError(t, err)

	rec := doGuestRequest(t, e, http.MethodGet, token, "")
	require.Equal(t, http.StatusOK, rec.Code)

	var resp rsvps.PartyRSVPsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Len(t, resp.Guests, 1, "the token's party_id claim scopes the data")
	assert.Equal(t, alice.ID, resp.Guests[0].ID)
	assert.False(t, resp.Closed)
}

func TestPutGuestRSVP_UpdatesAndReturnsRefreshedState(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)
	e, authSvc := newGuestEcho(t, svc)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createPublicEventT(t, eventSvc)

	token, err := authSvc.GenerateGuestToken(p.ID)
	require.NoError(t, err)

	body := `{"guests":[{"guest_id":"` + g.ID + `","dietary_restrictions":"vegetarian","rsvps":[{"event_id":"` + event.ID + `","status":"attending"}]}]}`
	rec := doGuestRequest(t, e, http.MethodPut, token, body)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var resp rsvps.PartyRSVPsResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Len(t, resp.Events, 1)
	require.Len(t, resp.Events[0].RSVPs, 1)
	assert.Equal(t, models.RSVPAttending, resp.Events[0].RSVPs[0].Status)

	assert.Equal(t, models.RSVPAttending, rsvpRow(t, db, event.ID, g.ID).Status)
}

func TestPutGuestRSVP_Returns403AfterDeadline(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)
	e, authSvc := newGuestEcho(t, svc)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createPublicEventT(t, eventSvc)
	setDeadline(t, db, -time.Hour)

	token, err := authSvc.GenerateGuestToken(p.ID)
	require.NoError(t, err)

	body := `{"guests":[{"guest_id":"` + g.ID + `","rsvps":[{"event_id":"` + event.ID + `","status":"attending"}]}]}`
	rec := doGuestRequest(t, e, http.MethodPut, token, body)
	require.Equal(t, http.StatusForbidden, rec.Code)

	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	assert.Equal(t, string(errcodes.CodeForbidden), envelope.Error.Code)
}

func TestPutGuestRSVP_Returns422ForInvalidStatus(t *testing.T) {
	svc, partySvc, eventSvc, _ := newServices(t)
	e, authSvc := newGuestEcho(t, svc)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createPublicEventT(t, eventSvc)

	token, err := authSvc.GenerateGuestToken(p.ID)
	require.NoError(t, err)

	// "maybe" is not a status: the binder's oneof rejects it before the service.
	body := `{"guests":[{"guest_id":"` + g.ID + `","rsvps":[{"event_id":"` + event.ID + `","status":"maybe"}]}]}`
	rec := doGuestRequest(t, e, http.MethodPut, token, body)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}
