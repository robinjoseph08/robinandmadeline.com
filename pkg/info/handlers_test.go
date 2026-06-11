package info_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/info"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newInfoEcho builds an Echo instance mirroring the production wiring of the
// info surface: the custom binder, the shared error handler, and the info
// routes mounted on the open /api group (no auth middleware; the URL token is
// the authentication, ADR 0003).
func newInfoEcho(t *testing.T, svc *info.Service) *echo.Echo {
	t.Helper()
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle

	info.RegisterRoutes(e.Group("/api"), svc)
	return e
}

func doInfoRequest(t *testing.T, e *echo.Echo, method, token, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(context.Background(), method, "/api/info/"+token, strings.NewReader(body))
	if body != "" {
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	}
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

func TestGetInfo_ReturnsTheTokenPartysData(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)
	e := newInfoEcho(t, svc)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationPhysical)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	rec := doInfoRequest(t, e, http.MethodGet, p.InfoToken, "")
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var resp info.PartyInfoResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, models.InvitationPhysical, resp.InvitationType)
	require.Len(t, resp.Guests, 1)
	assert.Equal(t, alice.ID, resp.Guests[0].ID)
	assert.True(t, resp.Guests[0].IsPrimary)
}

func TestGetInfo_UnknownTokenIs404(t *testing.T) {
	e := newInfoEcho(t, newInfoService(t))

	rec := doInfoRequest(t, e, http.MethodGet, "no-such-token", "")
	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestPutInfo_SavesAndReturnsRefreshedState(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)
	e := newInfoEcho(t, svc)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	body := `{"guests":[{"guest_id":"` + alice.ID + `","full_name":"Alice Smithe","email":"alice@example.com","phone":"(415) 555-2671"}]}`
	rec := doInfoRequest(t, e, http.MethodPut, p.InfoToken, body)
	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())

	var resp info.PartyInfoResponse
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Len(t, resp.Guests, 1)
	assert.Equal(t, "Alice Smithe", resp.Guests[0].FullName)
	require.NotNil(t, resp.Guests[0].Phone)
	// The binder's phone modifier normalizes to canonical E.164.
	assert.Equal(t, "+14155552671", *resp.Guests[0].Phone)
}

func TestPutInfo_InvalidEmailIs422ThroughTheBinder(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)
	e := newInfoEcho(t, svc)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	body := `{"guests":[{"guest_id":"` + alice.ID + `","email":"not-an-email"}]}`
	rec := doInfoRequest(t, e, http.MethodPut, p.InfoToken, body)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
}

func TestPutInfo_MissingRequiredFieldsIs422Envelope(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)
	e := newInfoEcho(t, svc)

	// A physical party submitting without an address fails the completion gate.
	p := createPartyT(t, partySvc, "The Smiths", models.InvitationPhysical)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	body := `{"guests":[{"guest_id":"` + alice.ID + `","email":"alice@example.com"}]}`
	rec := doInfoRequest(t, e, http.MethodPut, p.InfoToken, body)
	require.Equal(t, http.StatusUnprocessableEntity, rec.Code)

	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &envelope))
	assert.Equal(t, string(errcodes.CodeValidationError), envelope.Error.Code)
}

func TestPutInfo_UnknownTokenIs404(t *testing.T) {
	e := newInfoEcho(t, newInfoService(t))

	body := `{"guests":[{"guest_id":"00000000-0000-0000-0000-000000000000"}]}`
	rec := doInfoRequest(t, e, http.MethodPut, "no-such-token", body)
	assert.Equal(t, http.StatusNotFound, rec.Code)
}
