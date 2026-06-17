package settings

import "github.com/labstack/echo/v4"

// RegisterRoutes mounts the settings admin endpoints on the given group, which
// is expected to be the already-protected admin group (behind the admin JWT
// middleware), so every route here requires an admin token.
//
// Route shape (relative to the admin group, i.e. /api/admin):
//
//	GET    /settings    read the current app settings
//	PUT    /settings    partial update (each field independently)
func RegisterRoutes(admin *echo.Group, service *Service) {
	h := &handler{service: service}

	admin.GET("/settings", h.get)
	admin.PUT("/settings", h.update)
}
