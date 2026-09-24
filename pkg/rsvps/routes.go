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

// RegisterAdminRoutes mounts the admin view of the same party-level RSVP
// resource on the given group, which is expected to be the already-protected
// admin group (behind the admin JWT middleware). It lets the couple record a
// response a party gave them directly (a phone call, in person), with the
// same shape as the guest form.
//
// Route shape (relative to the admin group, i.e. /api/admin):
//
//	GET /parties/:id/rsvp    the party's guests + Event RSVPs grouped by event
//	PUT /parties/:id/rsvp    bulk-record the whole form (ignores the deadline)
func RegisterAdminRoutes(admin *echo.Group, service *Service) {
	h := &handler{service: service}

	admin.GET("/parties/:id/rsvp", h.getAdminPartyRSVPs)
	admin.PUT("/parties/:id/rsvp", h.recordPartyRSVPs)
}
