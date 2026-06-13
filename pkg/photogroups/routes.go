package photogroups

import "github.com/labstack/echo/v4"

// RegisterRoutes mounts the photo-groups admin endpoints on the given group,
// which is expected to be the already-protected admin group (behind the admin
// JWT middleware), so every route here requires an admin token.
//
// Route shape (relative to the admin group, i.e. /api/admin):
//
//	Photo groups (one global list in shooting order):
//	  GET    /photo-groups                       list
//	  POST   /photo-groups                       create (appended at the end)
//	  POST   /photo-groups/reorder               rewrite the shooting order
//	  PUT    /photo-groups/:id                   rename
//	  DELETE /photo-groups/:id                   delete (cascades to assignments)
//
//	Assignments (addressed by group + guest, their natural key; they have no
//	detail surface of their own):
//	  POST   /photo-groups/:id/guests            add a guest to the group (idempotent)
//	  DELETE /photo-groups/:id/guests/:guestId   remove a guest from the group
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

// RegisterGuestRoutes mounts the guest-facing photo-groups endpoint on the
// given group, which is expected to be the guest group behind RequireGuest,
// so the route requires a guest token whose party_id claim scopes the read:
//
//	GET /photo-groups    the groups the party's guests are in, with positions
//	                     and the names of the party's guests per group
func RegisterGuestRoutes(guest *echo.Group, service *Service) {
	h := &handler{service: service}
	guest.GET("/photo-groups", h.listPartyPhotoGroups)
}
