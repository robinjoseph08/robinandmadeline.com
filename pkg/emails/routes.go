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
//	  POST   /emails/test               enqueue the draft as a real test send to
//	                                    the configured inboxes (flagged is_test)
//	  GET    /emails/shell-preview      dev/design aid: the HTML shell rendered
//	                                    with sample content (text/html, not JSON)
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
	emails.POST("/test", h.sendTest)
	emails.GET("/shell-preview", h.shellPreview)
	emails.GET("/sends", h.listSends)
	emails.GET("/sends/:id", h.getSend)
}
