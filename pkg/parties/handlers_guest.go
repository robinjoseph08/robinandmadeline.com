package parties

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// guestBody is the JSON request body for creating or updating a guest. The
// party is taken from the route on create (POST /parties/:id/guests), so it is
// not a field here.
type guestBody struct {
	FullName            string   `json:"full_name"`
	Email               *string  `json:"email"`
	Phone               *string  `json:"phone"`
	Roles               []string `json:"roles"`
	IsPrimary           bool     `json:"is_primary"`
	IsChild             bool     `json:"is_child"`
	IsDrinking          bool     `json:"is_drinking"`
	IsPlaceholder       bool     `json:"is_placeholder"`
	DietaryRestrictions *string  `json:"dietary_restrictions"`
	TableNumber         *int     `json:"table_number"`
	SeatNumber          *int     `json:"seat_number"`
}

// listGuests handles GET /api/admin/guests, the flat guest list with filters:
// side, relation, circle, roles, is_drinking, is_child, is_placeholder. Event
// and RSVP-status filters are out of scope (they depend on #6).
func (h *handler) listGuests(c echo.Context) error {
	f := GuestFilter{
		Side:          queryStrPtr(c, "side"),
		Relation:      queryStrPtr(c, "relation"),
		Circle:        queryStrPtr(c, "circle"),
		Roles:         queryStrPtr(c, "roles"),
		IsDrinking:    queryBoolPtr(c, "is_drinking"),
		IsChild:       queryBoolPtr(c, "is_child"),
		IsPlaceholder: queryBoolPtr(c, "is_placeholder"),
	}

	guests, err := h.service.ListGuests(c.Request().Context(), f)
	if err != nil {
		return httpError(err)
	}
	// Coerce a nil slice (no matching guests) to an empty one so the response is
	// always a JSON array [], never null. This matches the parties list, whose
	// response wrapper already produces [] when empty, so clients can treat both
	// list endpoints uniformly.
	if guests == nil {
		guests = []*Guest{}
	}
	return c.JSON(http.StatusOK, guests)
}

// createGuest handles POST /api/admin/parties/:id/guests. It returns 201 with
// the created guest. Requesting is_primary demotes the party's previous primary.
func (h *handler) createGuest(c echo.Context) error {
	var body guestBody
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	// The request body and the service input share the same fields; the explicit
	// conversion keeps the JSON layer (tagged) and the service input (untagged)
	// as distinct types while avoiding a field-by-field copy.
	guest, err := h.service.CreateGuest(c.Request().Context(), c.Param("id"), CreateGuestInput(body))
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusCreated, guest)
}

// getGuest handles GET /api/admin/guests/:id.
func (h *handler) getGuest(c echo.Context) error {
	guest, err := h.service.GetGuest(c.Request().Context(), c.Param("id"))
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, guest)
}

// updateGuest handles PATCH /api/admin/guests/:id. Promoting to primary demotes
// the party's previous primary transactionally.
func (h *handler) updateGuest(c echo.Context) error {
	var body guestBody
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	guest, err := h.service.UpdateGuest(c.Request().Context(), c.Param("id"), UpdateGuestInput(body))
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, guest)
}

// deleteGuest handles DELETE /api/admin/guests/:id. Returns 204 on success.
func (h *handler) deleteGuest(c echo.Context) error {
	if err := h.service.DeleteGuest(c.Request().Context(), c.Param("id")); err != nil {
		return httpError(err)
	}
	return c.NoContent(http.StatusNoContent)
}
