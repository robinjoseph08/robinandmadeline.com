package events

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// handler holds the dependencies for the events HTTP handlers. It is
// unexported; routes are wired via RegisterRoutes. Handlers return errcodes
// errors directly (and the *Error the service produces flows through), which
// the shared error handler renders. There is no per-package error translation.
type handler struct {
	service *Service
}

// pathID returns the named route param when it parses as a UUID, or a 404
// naming the given resource otherwise. Ids are UUIDs, so a malformed one can
// never name an existing row; without this check it would reach Postgres as a
// failing text-to-uuid cast and render a 500 instead of the 404 a missing row
// gets. The id is returned in canonical form so the query sees exactly what
// was parsed.
func pathID(c echo.Context, param, resource string) (string, error) {
	id, err := uuid.Parse(c.Param(param))
	if err != nil {
		return "", errcodes.NotFound(resource)
	}
	return id.String(), nil
}

// listEvents handles GET /api/admin/events: every event in schedule order,
// each with its RSVP breakdown, in the uniform {items, total} envelope.
func (h *handler) listEvents(c echo.Context) error {
	ctx := c.Request().Context()
	list, total, err := h.service.ListEvents(ctx)
	if err != nil {
		return err
	}

	ids := make([]string, 0, len(list))
	for _, e := range list {
		ids = append(ids, e.ID)
	}
	breakdowns, err := h.service.RSVPBreakdowns(ctx, ids)
	if err != nil {
		return err
	}

	items := make([]EventResponse, 0, len(list))
	for _, e := range list {
		items = append(items, newEventResponse(e, breakdowns[e.ID]))
	}
	return c.JSON(http.StatusOK, ListEventsResponse{Items: items, Total: total})
}

// getEvent handles GET /api/admin/events/:id.
func (h *handler) getEvent(c echo.Context) error {
	id, err := pathID(c, "id", "event")
	if err != nil {
		return err
	}
	return h.respondWithEvent(c, http.StatusOK, func() (*models.Event, error) {
		return h.service.GetEvent(c.Request().Context(), id)
	})
}

// createEvent handles POST /api/admin/events, returning 201 with the created
// event. A public event is born with a pending Event RSVP for every existing
// guest (ADR 0002), which the response's breakdown already reflects.
func (h *handler) createEvent(c echo.Context) error {
	var body CreateEventPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	return h.respondWithEvent(c, http.StatusCreated, func() (*models.Event, error) {
		return h.service.CreateEvent(c.Request().Context(), body)
	})
}

// updateEvent handles PUT /api/admin/events/:id, the full-state update.
// Flipping the event public backfills pending Event RSVPs for every guest.
func (h *handler) updateEvent(c echo.Context) error {
	id, err := pathID(c, "id", "event")
	if err != nil {
		return err
	}
	var body UpdateEventPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	return h.respondWithEvent(c, http.StatusOK, func() (*models.Event, error) {
		return h.service.UpdateEvent(c.Request().Context(), id, body)
	})
}

// deleteEvent handles DELETE /api/admin/events/:id, returning 204 on success.
// The event's Event RSVP rows go with it via the FK cascade.
func (h *handler) deleteEvent(c echo.Context) error {
	id, err := pathID(c, "id", "event")
	if err != nil {
		return err
	}
	if err := h.service.DeleteEvent(c.Request().Context(), id); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// inviteParties handles POST /api/admin/events/:id/invite: bulk-creates
// pending Event RSVPs for every guest in the given parties (private events
// only). It returns the event with its refreshed breakdown so the UI can show
// the new invited count without a second request.
func (h *handler) inviteParties(c echo.Context) error {
	id, err := pathID(c, "id", "event")
	if err != nil {
		return err
	}
	var body InvitePartiesPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	return h.respondWithEvent(c, http.StatusOK, func() (*models.Event, error) {
		return h.service.InviteParties(c.Request().Context(), id, body)
	})
}

// listEventRSVPs handles GET /api/admin/events/:id/rsvps: every Event RSVP for
// the event with its guest and party context, in the uniform {items, total}
// envelope.
func (h *handler) listEventRSVPs(c echo.Context) error {
	id, err := pathID(c, "id", "event")
	if err != nil {
		return err
	}
	rows, total, err := h.service.ListEventRSVPs(c.Request().Context(), id)
	if err != nil {
		return err
	}
	items := make([]EventRSVPListItem, 0, len(rows))
	for _, r := range rows {
		items = append(items, newEventRSVPListItem(r))
	}
	return c.JSON(http.StatusOK, ListEventRSVPsResponse{Items: items, Total: total})
}

// updateEventRSVP handles PUT /api/admin/events/:id/rsvps/:guestId, the admin
// override for one guest's response (a phone or in-person answer). The row is
// addressed by its natural key (event, guest); a guest without a row for the
// event 404s, since there is no invitation to override.
func (h *handler) updateEventRSVP(c echo.Context) error {
	eventID, err := pathID(c, "id", "event")
	if err != nil {
		return err
	}
	guestID, err := pathID(c, "guestId", "RSVP")
	if err != nil {
		return err
	}
	var body UpdateEventRSVPPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}

	row, err := h.service.UpdateRSVPStatus(c.Request().Context(), eventID, guestID, body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, newEventRSVPListItem(row))
}

// listScheduleEvents handles GET /api/events, the guest-facing schedule. The
// route sits behind OptionalGuest: without a token the schedule holds public
// events only; with a valid guest token it also holds the private events the
// guest's party is invited to. photo_groups is always present and, until
// photo groups are built (a later slice), always empty.
func (h *handler) listScheduleEvents(c echo.Context) error {
	partyID := auth.GuestPartyID(c)
	list, total, err := h.service.ScheduleEvents(c.Request().Context(), partyID)
	if err != nil {
		return err
	}

	items := make([]ScheduleEvent, 0, len(list))
	for _, e := range list {
		items = append(items, ScheduleEvent{Event: *e, PhotoGroups: []SchedulePhotoGroup{}})
	}
	return c.JSON(http.StatusOK, ListScheduleEventsResponse{Items: items, Total: total})
}

// respondWithEvent runs an event write/read and renders the event with its
// RSVP breakdown, the shape every single-event endpoint shares.
func (h *handler) respondWithEvent(c echo.Context, status int, op func() (*models.Event, error)) error {
	event, err := op()
	if err != nil {
		return err
	}
	breakdowns, err := h.service.RSVPBreakdowns(c.Request().Context(), []string{event.ID})
	if err != nil {
		return err
	}
	return c.JSON(status, newEventResponse(event, breakdowns[event.ID]))
}
