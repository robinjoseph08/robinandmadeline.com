package rsvps

import "github.com/labstack/echo/v4"

// RegisterRoutes mounts the guest RSVP endpoints on the given group, which is
// expected to be the already-protected guest group (behind the guest JWT
// middleware), so every route here requires a guest token whose party_id
// claim scopes the data.
//
// Route shape (relative to the guest group, i.e. /api/guest):
//
//	GET /rsvp    the party's guests + Event RSVPs grouped by event (+ deadline state)
//	PUT /rsvp    bulk-submit the whole form (statuses, placeholder names, dietary)
//
// The resource is singular: a guest token addresses exactly one party, so
// there is nothing to list or address by id.
func RegisterRoutes(guest *echo.Group, service *Service) {
	h := &handler{service: service}

	guest.GET("/rsvp", h.getPartyRSVPs)
	guest.PUT("/rsvp", h.updatePartyRSVPs)
}
