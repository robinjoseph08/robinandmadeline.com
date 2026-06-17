package dashboard

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// handler holds the dependencies for the dashboard HTTP handler. It is
// unexported; routes are wired via RegisterRoutes. The handler returns the
// service's wrapped errors directly, which the shared error handler renders.
type handler struct {
	service *Service
}

// get handles GET /api/admin/dashboard: the overview stats, computed fresh.
func (h *handler) get(c echo.Context) error {
	resp, err := h.service.Overview(c.Request().Context())
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}
