package dashboard

import "github.com/labstack/echo/v4"

// RegisterRoutes mounts the dashboard endpoint on the given group, which is
// expected to be the already-protected admin group (behind the admin JWT
// middleware), so the route requires an admin token.
//
// Route shape (relative to the admin group, i.e. /api/admin):
//
//	GET    /dashboard    overview stats (computed fresh, never cached)
func RegisterRoutes(admin *echo.Group, service *Service) {
	h := &handler{service: service}

	admin.GET("/dashboard", h.get)
}
