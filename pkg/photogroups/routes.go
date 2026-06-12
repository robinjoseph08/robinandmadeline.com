package photogroups

import "github.com/labstack/echo/v4"

// RegisterRoutes mounts the photo-groups admin endpoints on the given group,
// which is expected to be the already-protected admin group (behind the admin
// JWT middleware), so every route here requires an admin token.
//
// Route shape (relative to the admin group, i.e. /api/admin):
//
//	Photo groups:
//	  GET    /photo-groups                       list (optionally ?event_id=, shooting order)
//	  POST   /photo-groups                       create (appended at the end of its event)
//	  POST   /photo-groups/reorder               rewrite one event's shooting order
//	  PUT    /photo-groups/:id                   rename
//	  DELETE /photo-groups/:id                   delete (cascades to assignments)
//
//	Assignments (addressed by group + guest, their natural key; they have no
//	detail surface of their own):
//	  POST   /photo-groups/:id/guests            add a guest to the group (idempotent)
//	  DELETE /photo-groups/:id/guests/:guestId   remove a guest from the group
//
// Photo groups mount flat rather than nested under /events/:id because the
// admin page manages every event's shot list at once; the owning event rides
// in the query string (list) or body (create, reorder).
func RegisterRoutes(admin *echo.Group, service *Service) {
	h := &handler{service: service}

	groups := admin.Group("/photo-groups")
	groups.GET("", h.listPhotoGroups)
	groups.POST("", h.createPhotoGroup)
	groups.POST("/reorder", h.reorderPhotoGroups)
	groups.PUT("/:id", h.updatePhotoGroup)
	groups.DELETE("/:id", h.deletePhotoGroup)
	groups.POST("/:id/guests", h.addGuest)
	groups.DELETE("/:id/guests/:guestId", h.removeGuest)
}
