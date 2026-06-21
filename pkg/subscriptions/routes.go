package subscriptions

import "github.com/labstack/echo/v4"

// RegisterRoutes mounts the guest-facing subscription endpoints on the open
// /api group: there is no JWT, the guest's own UUID in the URL is the
// authentication (ADR 0009). The id is high-entropy (a v7 UUID), so like the
// info token, and unlike the guessable RSVP codes, it needs no rate limiter.
//
// Route shape (relative to the group, i.e. /api):
//
//	GET  /subscriptions/:id   the guest's current subscription view
//	POST /subscriptions/:id   set the guest's subscription (unsubscribe/resubscribe)
//
// These back the unsubscribe landing page. The RFC 8058 one-click endpoint that
// the List-Unsubscribe header points at is registered separately, off the /api
// prefix, so the same /u/:id path can render the page on GET.
func RegisterRoutes(api *echo.Group, service *Service) {
	h := &handler{service: service}

	g := api.Group("/subscriptions")
	g.GET("/:id", h.getSubscription)
	g.POST("/:id", h.updateSubscription)
}
