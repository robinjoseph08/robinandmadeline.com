package emails

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
)

// handler holds the dependencies for the emails HTTP handlers. It is
// unexported; routes are wired via RegisterRoutes. Handlers return errcodes
// errors directly (and the *Error the service produces flows through), which
// the shared error handler renders.
type handler struct {
	service *Service
}

// pathID returns the :id route param when it parses as a UUID, or a 404
// naming the given resource otherwise. Ids are UUIDs, so a malformed one can
// never name an existing row; without this check it would reach Postgres as a
// failing text-to-uuid cast and render a 500 instead of the 404 a missing row
// gets.
func pathID(c echo.Context, resource string) (string, error) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		return "", errcodes.NotFound(resource)
	}
	return id.String(), nil
}

// listTemplates handles GET /api/admin/emails/templates.
func (h *handler) listTemplates(c echo.Context) error {
	templates, total, err := h.service.ListTemplates(c.Request().Context())
	if err != nil {
		return err
	}
	items := make([]TemplateResponse, 0, len(templates))
	for _, tpl := range templates {
		items = append(items, newTemplateResponse(tpl))
	}
	return c.JSON(http.StatusOK, ListTemplatesResponse{Items: items, Total: total})
}

// getTemplate handles GET /api/admin/emails/templates/:id.
func (h *handler) getTemplate(c echo.Context) error {
	id, err := pathID(c, "email template")
	if err != nil {
		return err
	}
	tpl, err := h.service.GetTemplate(c.Request().Context(), id)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, newTemplateResponse(tpl))
}

// createTemplate handles POST /api/admin/emails/templates, returning 201.
func (h *handler) createTemplate(c echo.Context) error {
	var body CreateTemplatePayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	tpl, err := h.service.CreateTemplate(c.Request().Context(), body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, newTemplateResponse(tpl))
}

// updateTemplate handles PUT /api/admin/emails/templates/:id, the full-state
// update.
func (h *handler) updateTemplate(c echo.Context) error {
	id, err := pathID(c, "email template")
	if err != nil {
		return err
	}
	var body UpdateTemplatePayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	tpl, err := h.service.UpdateTemplate(c.Request().Context(), id, body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, newTemplateResponse(tpl))
}

// deleteTemplate handles DELETE /api/admin/emails/templates/:id, returning
// 204. Past sends that referenced the template survive (FK SET NULL).
func (h *handler) deleteTemplate(c echo.Context) error {
	id, err := pathID(c, "email template")
	if err != nil {
		return err
	}
	if err := h.service.DeleteTemplate(c.Request().Context(), id); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// preview handles POST /api/admin/emails/preview: the matched recipients plus
// the subject/body rendered for a sample recipient, without sending anything.
func (h *handler) preview(c echo.Context) error {
	var body PreviewEmailPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	resp, err := h.service.Preview(c.Request().Context(), body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}

// send handles POST /api/admin/emails/send: records the send, enqueues one
// recipient row per matching guest, and returns 201 immediately; the Worker
// dispatches asynchronously (ADR 0004).
func (h *handler) send(c echo.Context) error {
	var body SendEmailPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	send, stats, err := h.service.CreateSend(c.Request().Context(), body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, newSendResponse(send, stats))
}

// sendTest handles POST /api/admin/emails/test: renders the draft against
// sample merge data through the real HTML shell pipeline and dispatches it
// synchronously to the configured test recipients (the couple's inboxes), so
// the couple can eyeball the email. It creates no send/recipient rows and does
// not touch the daily budget; a 422 results when no test recipients are
// configured or Mailgun is off.
func (h *handler) sendTest(c echo.Context) error {
	var body TestEmailPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	resp, err := h.service.SendTest(c.Request().Context(), body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}

// shellPreview handles GET /api/admin/emails/shell-preview. It is a dev/design
// aid: it renders the HTML email shell with FIXED sample Markdown content and
// sample merge values and returns it as text/html (NOT the typed-JSON envelope
// the rest of the API uses), so a developer editing shell.html can refresh the
// browser (air hot-reloads the API) and see the result. This text/html response
// is a deliberate, commented exception to the typed-JSON rule precisely because
// it previews an HTML email.
func (h *handler) shellPreview(c echo.Context) error {
	return c.HTML(http.StatusOK, h.service.ShellPreviewHTML())
}

// listSends handles GET /api/admin/emails/sends: every send, newest first,
// each with its per-status recipient stats.
func (h *handler) listSends(c echo.Context) error {
	ctx := c.Request().Context()
	sends, total, err := h.service.ListSends(ctx)
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(sends))
	for _, s := range sends {
		ids = append(ids, s.ID)
	}
	stats, err := h.service.SendStatsBySendIDs(ctx, ids)
	if err != nil {
		return err
	}
	items := make([]SendResponse, 0, len(sends))
	for _, s := range sends {
		items = append(items, newSendResponse(s, stats[s.ID]))
	}
	return c.JSON(http.StatusOK, ListSendsResponse{Items: items, Total: total})
}

// getSend handles GET /api/admin/emails/sends/:id: the send, its stats, and
// every recipient row with its delivery status.
func (h *handler) getSend(c echo.Context) error {
	id, err := pathID(c, "email send")
	if err != nil {
		return err
	}
	ctx := c.Request().Context()
	send, recipients, err := h.service.GetSendDetail(ctx, id)
	if err != nil {
		return err
	}
	stats, err := h.service.SendStatsBySendIDs(ctx, []string{send.ID})
	if err != nil {
		return err
	}
	items := make([]SendRecipientItem, 0, len(recipients))
	for _, r := range recipients {
		items = append(items, newSendRecipientItem(r))
	}
	return c.JSON(http.StatusOK, SendDetailResponse{
		EmailSend:  *send,
		Stats:      stats[send.ID],
		Recipients: items,
	})
}
