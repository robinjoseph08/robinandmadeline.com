package rsvps

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
)

// handler holds the dependencies for the guest RSVP HTTP handlers. It is
// unexported; routes are wired via RegisterRoutes. Handlers return errcodes
// errors directly (and the *Error the service produces flows through), which
// the shared error handler renders.
type handler struct {
	service *Service
}

// getPartyRSVPs handles GET /api/guest/rsvp: the authenticated party's guests
// and Event RSVPs grouped by event, plus the deadline state (closed tells the
// form to render read-only). The party comes from the guest JWT, never from
// the request, so a guest can only ever see their own party.
func (h *handler) getPartyRSVPs(c echo.Context) error {
	partyID, err := auth.PartyIDFromContext(c)
	if err != nil {
		return err
	}

	resp, err := h.service.PartyRSVPs(c.Request().Context(), partyID)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}

// updatePartyRSVPs handles PUT /api/guest/rsvp: the whole form submitted at
// once (statuses, placeholder names, dietary restrictions). A past deadline is
// a 403. On success it returns the refreshed view, so the confirmation screen
// renders from the same response shape as the form.
func (h *handler) updatePartyRSVPs(c echo.Context) error {
	partyID, err := auth.PartyIDFromContext(c)
	if err != nil {
		return err
	}

	var body UpdatePartyRSVPsPayload
	if err := c.Bind(&body); err != nil {
		// The custom binder already returns the right errcode (422/400); preserve it.
		return errors.WithStack(err)
	}

	resp, err := h.service.UpdatePartyRSVPs(c.Request().Context(), partyID, body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, resp)
}
