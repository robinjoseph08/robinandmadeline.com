package events

import (
	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
)

// RegisterRoutes mounts the events admin endpoints on the given group, which is
// expected to be the already-protected admin group (behind the admin JWT
// middleware), so every route here requires an admin token.
//
// Route shape (relative to the admin group, i.e. /api/admin):
//
//	Events:
//	  GET    /events                        list (schedule order, with RSVP breakdowns)
//	  POST   /events                        create (public events backfill all guests)
//	  GET    /events/:id                    get one
//	  PUT    /events/:id                    full update of editable fields
//	  DELETE /events/:id                    delete (cascades to event_rsvps)
//	  POST   /events/:id/invite             invite parties to a private event
//
//	Event RSVPs (a row is the invitation, ADR 0002; addressed by event + guest):
//	  GET    /events/:id/rsvps              list with guest/party context
//	  PUT    /events/:id/rsvps/:guestId     admin override of one guest's status
//
// RSVP rows stay nested under their event because (event, guest) is their
// natural key: the admin always reaches one in the context of an event, and
// the rows have no detail surface of their own.
func RegisterRoutes(admin *echo.Group, service *Service) {
	h := &handler{service: service}

	events := admin.Group("/events")
	events.GET("", h.listEvents)
	events.POST("", h.createEvent)
	events.GET("/:id", h.getEvent)
	events.PUT("/:id", h.updateEvent)
	events.DELETE("/:id", h.deleteEvent)
	events.POST("/:id/invite", h.inviteParties)
	events.GET("/:id/rsvps", h.listEventRSVPs)
	events.PUT("/:id/rsvps/:guestId", h.updateEventRSVP)
}

// RegisterScheduleRoutes mounts the guest-facing schedule endpoint on the
// open /api group, behind the optional-guest middleware:
//
//	GET /events    the schedule (public events; plus the party's invited
//	               events when a valid guest token is presented)
//
// It is the one events route outside the admin group: the schedule is the
// public face of the same data, read-only, personalized by the guest JWT when
// one is offered and anonymous otherwise (a presented-but-invalid token is a
// 401, see auth.OptionalGuest).
func RegisterScheduleRoutes(api *echo.Group, mw *auth.Middleware, service *Service) {
	h := &handler{service: service}
	api.GET("/events", h.listScheduleEvents, mw.OptionalGuest)
}
