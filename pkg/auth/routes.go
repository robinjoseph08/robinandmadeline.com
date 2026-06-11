package auth

import (
	"github.com/labstack/echo/v4"
	"github.com/uptrace/bun"
)

// RegisterRoutes mounts the auth endpoints on the given API group.
//
// It registers POST /auth/admin/login and POST /auth/guest/login (relative to
// the group, so /api/auth/... when the group is mounted at /api). Both login
// routes sit behind one shared per-IP rate limiter built from rl, so guest and
// admin attempts draw from the same budget (ADR 0006). The db backs the guest
// login's party-by-RSVP-code lookup.
func RegisterRoutes(api *echo.Group, service *Service, db *bun.DB, rl RateLimit) {
	h := &handler{service: service, db: db}

	limiter := loginRateLimiter(rl)
	g := api.Group("/auth")
	g.POST("/admin/login", h.adminLogin, limiter)
	g.POST("/guest/login", h.guestLogin, limiter)
}
