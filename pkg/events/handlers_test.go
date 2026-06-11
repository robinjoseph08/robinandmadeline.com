package events_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/binder"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAPI wires the events routes onto a bare Echo group with the shared error
// handler AND the custom binder (no auth middleware: these tests exercise the
// handlers, validation pipeline, and response shapes, while auth enforcement
// is covered by the server package). Wiring the real binder means requests
// flow through the same bind -> mod -> default -> validate pipeline as
// production. It uses the package's isolated Postgres test database; the
// returned services build fixtures.
func newAPI(t *testing.T) (*echo.Echo, *events.Service, *parties.Service) {
	t.Helper()
	svc, partySvc, _ := newServices(t)
	e := echo.New()
	b, err := binder.New()
	require.NoError(t, err)
	e.Binder = b
	e.HTTPErrorHandler = errcodes.NewHandler().Handle
	g := e.Group("/api/admin")
	events.RegisterRoutes(g, svc)
	return e, svc, partySvc
}

// do issues a JSON request against the handler and returns the recorder.
func do(t *testing.T, e *echo.Echo, method, target string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body != nil {
		b, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(b)
	} else {
		reader = bytes.NewReader(nil)
	}
	req := httptest.NewRequestWithContext(context.Background(), method, target, reader)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	e.ServeHTTP(rec, req)
	return rec
}

// errorCode extracts the error envelope's code from a response.
func errorCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	return body.Error.Code
}

func TestCreateEventHandler_ReturnsEventWithBreakdown(t *testing.T) {
	e, _, partySvc := newAPI(t)

	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")
	addGuestT(t, partySvc, p.ID, "Bob")

	rec := do(t, e, http.MethodPost, "/api/admin/events", map[string]any{
		"name": "Reception", "date": "2026-10-17", "is_public": true,
	})
	require.Equal(t, http.StatusCreated, rec.Code)

	var resp struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		IsPublic      bool   `json:"is_public"`
		RSVPBreakdown struct {
			Pending int `json:"pending"`
			Total   int `json:"total"`
		} `json:"rsvp_breakdown"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.NotEmpty(t, resp.ID)
	assert.Equal(t, "Reception", resp.Name)
	assert.True(t, resp.IsPublic)
	// The breakdown already reflects the public backfill: both guests pending.
	assert.Equal(t, 2, resp.RSVPBreakdown.Pending)
	assert.Equal(t, 2, resp.RSVPBreakdown.Total)
}

func TestCreateEventHandler_MissingNameIs422(t *testing.T) {
	e, _, _ := newAPI(t)
	rec := do(t, e, http.MethodPost, "/api/admin/events", map[string]any{
		"date": "2026-10-17",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestCreateEventHandler_BadDateFormatIs422(t *testing.T) {
	e, _, _ := newAPI(t)
	rec := do(t, e, http.MethodPost, "/api/admin/events", map[string]any{
		"name": "Reception", "date": "10/17/2026",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestCreateEventHandler_BadStartTimeIs422(t *testing.T) {
	e, _, _ := newAPI(t)
	rec := do(t, e, http.MethodPost, "/api/admin/events", map[string]any{
		"name": "Reception", "date": "2026-10-17", "start_time": "5pm",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestListEventsHandler_ReturnsEnvelope(t *testing.T) {
	e, svc, _ := newAPI(t)
	createEventT(t, svc, publicEventInput())

	rec := do(t, e, http.MethodGet, "/api/admin/events", nil)
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Items []json.RawMessage `json:"items"`
		Total int               `json:"total"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, 1, resp.Total)
	assert.Len(t, resp.Items, 1)
}

func TestGetEventHandler_MalformedIDIs404(t *testing.T) {
	e, _, _ := newAPI(t)
	rec := do(t, e, http.MethodGet, "/api/admin/events/not-a-uuid", nil)
	assert.Equal(t, http.StatusNotFound, rec.Code)
	assert.Equal(t, string(errcodes.CodeNotFound), errorCode(t, rec))
}

func TestDeleteEventHandler_Returns204(t *testing.T) {
	e, svc, _ := newAPI(t)
	event := createEventT(t, svc, privateEventInput())

	rec := do(t, e, http.MethodDelete, "/api/admin/events/"+event.ID, nil)
	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestInviteHandler_EmptyPartyIDsIs422(t *testing.T) {
	e, svc, _ := newAPI(t)
	event := createEventT(t, svc, privateEventInput())

	rec := do(t, e, http.MethodPost, "/api/admin/events/"+event.ID+"/invite", map[string]any{
		"party_ids": []string{},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestInviteHandler_NonUUIDPartyIDIs422(t *testing.T) {
	e, svc, _ := newAPI(t)
	event := createEventT(t, svc, privateEventInput())

	rec := do(t, e, http.MethodPost, "/api/admin/events/"+event.ID+"/invite", map[string]any{
		"party_ids": []string{"nope"},
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}

func TestInviteHandler_ReturnsRefreshedBreakdown(t *testing.T) {
	e, svc, partySvc := newAPI(t)

	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")
	addGuestT(t, partySvc, p.ID, "Bob")
	event := createEventT(t, svc, privateEventInput())

	rec := do(t, e, http.MethodPost, "/api/admin/events/"+event.ID+"/invite", map[string]any{
		"party_ids": []string{p.ID},
	})
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		RSVPBreakdown struct {
			Pending int `json:"pending"`
			Total   int `json:"total"`
		} `json:"rsvp_breakdown"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, 2, resp.RSVPBreakdown.Pending)
	assert.Equal(t, 2, resp.RSVPBreakdown.Total)
}

func TestListEventRSVPsHandler_CarriesGuestAndPartyContext(t *testing.T) {
	e, svc, partySvc := newAPI(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createEventT(t, svc, publicEventInput())

	rec := do(t, e, http.MethodGet, "/api/admin/events/"+event.ID+"/rsvps", nil)
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Items []struct {
			GuestID   string `json:"guest_id"`
			Status    string `json:"status"`
			GuestName string `json:"guest_name"`
			PartyID   string `json:"party_id"`
			PartyName string `json:"party_name"`
		} `json:"items"`
		Total int `json:"total"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	require.Equal(t, 1, resp.Total)
	require.Len(t, resp.Items, 1)
	assert.Equal(t, g.ID, resp.Items[0].GuestID)
	assert.Equal(t, models.RSVPPending, resp.Items[0].Status)
	assert.Equal(t, "Alice", resp.Items[0].GuestName)
	assert.Equal(t, p.ID, resp.Items[0].PartyID)
	assert.Equal(t, "The Smiths", resp.Items[0].PartyName)
}

func TestUpdateEventRSVPHandler_OverridesStatus(t *testing.T) {
	e, svc, partySvc := newAPI(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createEventT(t, svc, publicEventInput())

	rec := do(t, e, http.MethodPut, "/api/admin/events/"+event.ID+"/rsvps/"+g.ID, map[string]any{
		"status": "attending",
	})
	require.Equal(t, http.StatusOK, rec.Code)

	var resp struct {
		Status   string  `json:"status"`
		RSVPedAt *string `json:"rsvped_at"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &resp))
	assert.Equal(t, models.RSVPAttending, resp.Status)
	assert.NotNil(t, resp.RSVPedAt)
}

func TestUpdateEventRSVPHandler_InvalidStatusIs422(t *testing.T) {
	e, svc, partySvc := newAPI(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createEventT(t, svc, publicEventInput())

	rec := do(t, e, http.MethodPut, "/api/admin/events/"+event.ID+"/rsvps/"+g.ID, map[string]any{
		"status": "maybe",
	})
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Equal(t, string(errcodes.CodeValidationError), errorCode(t, rec))
}
