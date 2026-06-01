package auth

import "github.com/labstack/echo/v4"

// RegisterRoutes mounts the auth endpoints on the given API group.
//
// It registers POST /auth/admin/login (relative to the group, so /api/auth/...
// when the group is mounted at /api). The guest login endpoint is built in a
// later issue and is intentionally absent here.
func RegisterRoutes(api *echo.Group, service *Service) {
	h := &handler{service: service}

	g := api.Group("/auth")
	g.POST("/admin/login", h.adminLogin)
}
