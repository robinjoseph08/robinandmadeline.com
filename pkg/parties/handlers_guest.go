package parties

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
)

// listGuests handles GET /api/admin/guests, the flat guest list with filters:
// side, relation, circle, tags, is_drinking, is_child, is_placeholder, plus
// event_id and rsvp_status (which filter through the guest's Event RSVP rows).
// It returns the uniform {items, total} envelope.
func (h *handler) listGuests(c echo.Context) error {
	var q ListGuestsQuery
	if err := c.Bind(&q); err != nil {
		return errors.WithStack(err)
	}

	guests, total, err := h.service.ListGuests(c.Request().Context(), q)
	if err != nil {
		return err
	}
	items := make([]GuestListItem, 0, len(guests))
	for _, g := range guests {
		items = append(items, newGuestListItem(g))
	}
	return c.JSON(http.StatusOK, ListGuestsResponse{Items: items, Total: total})
}

// createGuest handles POST /api/admin/parties/:id/guests, returning 201 with the
// created guest. Requesting is_primary demotes the party's previous primary.
func (h *handler) createGuest(c echo.Context) error {
	// The :id here is the owning party's, so a malformed one 404s as a party.
	partyID, err := pathID(c, "party")
	if err != nil {
		return err
	}
	var body CreateGuestPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}

	guest, err := h.service.CreateGuest(c.Request().Context(), partyID, body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, newGuestResponse(guest))
}

// getGuest handles GET /api/admin/guests/:id.
func (h *handler) getGuest(c echo.Context) error {
	id, err := pathID(c, "guest")
	if err != nil {
		return err
	}
	guest, err := h.service.GetGuest(c.Request().Context(), id)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, newGuestResponse(guest))
}

// updateGuest handles PUT /api/admin/guests/:id, the full-state update behind
// the edit dialog. Promoting to primary demotes the party's previous primary
// transactionally.
func (h *handler) updateGuest(c echo.Context) error {
	id, err := pathID(c, "guest")
	if err != nil {
		return err
	}
	var body UpdateGuestPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}

	guest, err := h.service.UpdateGuest(c.Request().Context(), id, body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, newGuestResponse(guest))
}

// patchGuest handles PATCH /api/admin/guests/:id, a partial update: only the
// fields present in the body change (the spreadsheet's single-cell save).
// Promoting to primary demotes the party's previous primary transactionally.
func (h *handler) patchGuest(c echo.Context) error {
	id, err := pathID(c, "guest")
	if err != nil {
		return err
	}
	var body PatchGuestPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}

	guest, err := h.service.PatchGuest(c.Request().Context(), id, body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, newGuestResponse(guest))
}

// deleteGuest handles DELETE /api/admin/guests/:id, returning 204 on success.
func (h *handler) deleteGuest(c echo.Context) error {
	id, err := pathID(c, "guest")
	if err != nil {
		return err
	}
	if err := h.service.DeleteGuest(c.Request().Context(), id); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}
