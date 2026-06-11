package info

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
)

// handler holds the dependencies for the info-collection HTTP handlers. It is
// unexported; routes are wired via RegisterRoutes. Handlers return errcodes
// errors directly (and the *Error the service produces flows through), which
// the shared error handler renders.
type handler struct {
	service *Service
}

// getPartyInfo handles GET /api/info/:token: the token's party and its guests
// with their current contact details. The token is the authentication (ADR
// 0003); an unknown one is a 404, indistinguishable from a never-issued link.
func (h *handler) getPartyInfo(c echo.Context) error {
	resp, err := h.service.PartyInfo(c.Request().Context(), c.Param("token"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}

// updatePartyInfo handles PUT /api/info/:token: the whole form submitted at
// once (name corrections, contact details, removals, the address). A submit
// missing the party's required fields is a 422 and persists nothing. On
// success it returns the refreshed view, so the page re-renders from the same
// response shape as the GET.
func (h *handler) updatePartyInfo(c echo.Context) error {
	var body UpdatePartyInfoPayload
	if err := c.Bind(&body); err != nil {
		// The custom binder already returns the right errcode (422/400); preserve it.
		return errors.WithStack(err)
	}

	resp, err := h.service.UpdatePartyInfo(c.Request().Context(), c.Param("token"), body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}
