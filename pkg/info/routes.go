package info

import "github.com/labstack/echo/v4"

// RegisterRoutes mounts the info-collection endpoints on the given group,
// which is expected to be the open /api group: there is no JWT here, the
// opaque per-party info token in the URL is the authentication (ADR 0003).
// The token is high-entropy and random (unlike the guessable RSVP codes), so
// no rate limiter compensates for it (ADR 0006 applies to the login routes).
//
// Route shape (relative to the group, i.e. /api):
//
//	GET /info/:token    the token's party + guests with contact details
//	PUT /info/:token    bulk-submit the whole info form
func RegisterRoutes(api *echo.Group, service *Service) {
	h := &handler{service: service}

	g := api.Group("/info")
	g.GET("/:token", h.getPartyInfo)
	g.PUT("/:token", h.updatePartyInfo)
}
