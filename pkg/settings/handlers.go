package settings

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
)

// handler holds the dependencies for the settings HTTP handlers. It is
// unexported; routes are wired via RegisterRoutes. Handlers return errcodes
// errors directly, which the shared error handler renders.
type handler struct {
	service *Service
}

// get handles GET /api/admin/settings: the current app settings.
func (h *handler) get(c echo.Context) error {
	resp, err := h.service.Get(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}

// update handles PUT /api/admin/settings: a partial settings update, returning
// the refreshed state. The binder validates the payload (a malformed
// rsvp_deadline or contact_email is a 422); the service persists it.
func (h *handler) update(c echo.Context) error {
	var body UpdateSettingsPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	resp, err := h.service.Update(c.Request().Context(), body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}
