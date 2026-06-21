package subscriptions

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
)

// handler holds the dependencies for the guest-facing subscription HTTP
// handlers. Unexported; routes are wired via RegisterRoutes.
type handler struct {
	service *Service
}

// getSubscription handles GET /api/subscriptions/:id: the guest's current
// subscription view for the unsubscribe page to render. The id is the
// authentication (ADR 0009); an unknown or malformed one is a 404, which the
// page shows as a no-longer-valid link.
func (h *handler) getSubscription(c echo.Context) error {
	resp, err := h.service.Subscription(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}

// updateSubscription handles POST /api/subscriptions/:id: set the guest's
// subscription from the page's Unsubscribe or Resubscribe button. It returns the
// refreshed view so the page re-renders from the same shape as the GET.
func (h *handler) updateSubscription(c echo.Context) error {
	var body UpdateSubscriptionPayload
	if err := c.Bind(&body); err != nil {
		// The custom binder already returns the right errcode (422/400); preserve it.
		return errors.WithStack(err)
	}

	resp, err := h.service.SetSubscription(c.Request().Context(), c.Param("id"), *body.Subscribed)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}
