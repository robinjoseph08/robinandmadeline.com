package emails

import "github.com/labstack/echo/v4"

// RegisterRoutes mounts the email admin endpoints on the given group, which is
// expected to be the already-protected admin group (behind the admin JWT
// middleware), so every route here requires an admin token.
//
// Route shape (relative to the admin group, i.e. /api/admin):
//
//	Templates:
//	  GET    /emails/templates          list
//	  POST   /emails/templates          create
//	  GET    /emails/templates/:id      get one
//	  PUT    /emails/templates/:id      full update of editable fields
//	  DELETE /emails/templates/:id      delete (past sends keep their snapshot)
//
//	Composing and sending (ADR 0004):
//	  POST   /emails/preview            resolve recipients + render a sample
//	  POST   /emails/send               record send, enqueue recipients, return
//
//	History:
//	  GET    /emails/sends              list with per-status recipient stats
//	  GET    /emails/sends/:id          detail with per-recipient statuses
//
// The Mailgun delivery webhook is separate (RegisterWebhookRoutes): it is
// called by Mailgun, not the admin, and authenticates by signature instead.
func RegisterRoutes(admin *echo.Group, service *Service) {
	h := &handler{service: service}

	emails := admin.Group("/emails")
	emails.GET("/templates", h.listTemplates)
	emails.POST("/templates", h.createTemplate)
	emails.GET("/templates/:id", h.getTemplate)
	emails.PUT("/templates/:id", h.updateTemplate)
	emails.DELETE("/templates/:id", h.deleteTemplate)
	emails.POST("/preview", h.preview)
	emails.POST("/send", h.send)
	emails.GET("/sends", h.listSends)
	emails.GET("/sends/:id", h.getSend)
}
