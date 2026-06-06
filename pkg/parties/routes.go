package parties

import "github.com/labstack/echo/v4"

// RegisterRoutes mounts the parties/guests admin endpoints on the given group,
// which is expected to be the already-protected admin group (behind the admin
// JWT middleware), so every route here requires an admin token.
//
// Route shape (relative to the admin group, i.e. /api/admin):
//
//	Parties (a party owns its guests; nested create keeps the party in the URL):
//	  GET    /parties                       list (filterable)
//	  POST   /parties                       create (auto-generates info token)
//	  GET    /parties/:id                   get one
//	  PUT    /parties/:id                   update editable fields
//	  DELETE /parties/:id                   delete (cascades to guests)
//	  POST   /parties/:id/request-info      mark info link sent
//	  POST   /parties/:id/mark-info         mark complete|incomplete
//	  POST   /parties/:id/guests            create a guest in this party
//
//	Guests (flat collection once they exist; addressed by their own id):
//	  GET    /guests                        flat list (filterable)
//	  GET    /guests/:id                    get one
//	  PATCH  /guests/:id                    update editable fields
//	  DELETE /guests/:id                    delete
//
// Guest creation is nested under the party (the party is required and part of
// the resource's identity), while reads/updates/deletes address the guest
// directly by id, which keeps those handlers party-agnostic.
func RegisterRoutes(admin *echo.Group, service *Service) {
	h := &handler{service: service}

	parties := admin.Group("/parties")
	parties.GET("", h.listParties)
	parties.POST("", h.createParty)
	parties.GET("/:id", h.getParty)
	parties.PUT("/:id", h.updateParty)
	parties.DELETE("/:id", h.deleteParty)
	parties.POST("/:id/request-info", h.requestInfo)
	parties.POST("/:id/mark-info", h.markInfo)
	parties.POST("/:id/guests", h.createGuest)

	guests := admin.Group("/guests")
	guests.GET("", h.listGuests)
	guests.GET("/:id", h.getGuest)
	guests.PATCH("/:id", h.updateGuest)
	guests.DELETE("/:id", h.deleteGuest)
}
