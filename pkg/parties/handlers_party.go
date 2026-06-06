package parties

import (
	"net/http"

	"github.com/labstack/echo/v4"
)

// partyBody is the JSON request body for creating or updating a party. The
// pointer address fields let a client send null to clear an optional field. The
// info token (always generated) and the info_collection_* flags (moved only via
// the transition endpoints) are intentionally not accepted here.
type partyBody struct {
	Name            string   `json:"name"`
	Side            string   `json:"side"`
	Relation        string   `json:"relation"`
	Circle          []string `json:"circle"`
	InvitationType  string   `json:"invitation_type"`
	AddressLine1    *string  `json:"address_line_1"`
	AddressLine2    *string  `json:"address_line_2"`
	City            *string  `json:"city"`
	StateOrProvince *string  `json:"state_or_province"`
	PostalCode      *string  `json:"postal_code"`
	Country         *string  `json:"country"`
	RSVPCode        *string  `json:"rsvp_code"`
}

// listParties handles GET /api/admin/parties with optional query filters:
// side, relation, circle, invitation_type, info_collection_status,
// info_collection_requested.
func (h *handler) listParties(c echo.Context) error {
	f := PartyFilter{
		Side:                    queryStrPtr(c, "side"),
		Relation:                queryStrPtr(c, "relation"),
		Circle:                  queryStrPtr(c, "circle"),
		InvitationType:          queryStrPtr(c, "invitation_type"),
		InfoCollectionStatus:    queryStrPtr(c, "info_collection_status"),
		InfoCollectionRequested: queryBoolPtr(c, "info_collection_requested"),
	}

	parties, err := h.service.ListParties(c.Request().Context(), f)
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, newPartyResponses(parties))
}

// getParty handles GET /api/admin/parties/:id.
func (h *handler) getParty(c echo.Context) error {
	party, err := h.service.GetParty(c.Request().Context(), c.Param("id"))
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, newPartyResponse(party))
}

// createParty handles POST /api/admin/parties. It returns 201 with the created
// party (including its generated info token and derived status).
func (h *handler) createParty(c echo.Context) error {
	var body partyBody
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	// The request body mirrors the service input field-for-field; the explicit
	// conversion keeps the tagged JSON type and the untagged service input
	// distinct without a manual field copy.
	party, err := h.service.CreateParty(c.Request().Context(), CreatePartyInput(body))
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusCreated, newPartyResponse(party))
}

// updateParty handles PUT /api/admin/parties/:id. It replaces the editable
// fields and never alters the info token or collection status.
func (h *handler) updateParty(c echo.Context) error {
	var body partyBody
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	party, err := h.service.UpdateParty(c.Request().Context(), c.Param("id"), UpdatePartyInput(body))
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, newPartyResponse(party))
}

// deleteParty handles DELETE /api/admin/parties/:id. It returns 204 on success.
func (h *handler) deleteParty(c echo.Context) error {
	if err := h.service.DeleteParty(c.Request().Context(), c.Param("id")); err != nil {
		return httpError(err)
	}
	return c.NoContent(http.StatusNoContent)
}

// requestInfo handles POST /api/admin/parties/:id/request-info. It marks the
// info link as sent (requested=true, confirmed=false), resetting status to
// waiting.
func (h *handler) requestInfo(c echo.Context) error {
	party, err := h.service.RequestInfo(c.Request().Context(), c.Param("id"))
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, newPartyResponse(party))
}

// markInfoBody is the body of POST /api/admin/parties/:id/mark-info, selecting
// the target status. status must be "complete" or "incomplete".
type markInfoBody struct {
	Status string `json:"status"`
}

// markInfo handles POST /api/admin/parties/:id/mark-info. With status=complete
// it gates on required fields (422 if missing); with status=incomplete it
// re-opens the party.
func (h *handler) markInfo(c echo.Context) error {
	var body markInfoBody
	if err := c.Bind(&body); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	ctx := c.Request().Context()
	id := c.Param("id")

	var (
		party *Party
		err   error
	)
	switch body.Status {
	case StatusComplete:
		party, err = h.service.MarkComplete(ctx, id)
	case StatusIncomplete:
		party, err = h.service.MarkIncomplete(ctx, id)
	default:
		return echo.NewHTTPError(http.StatusBadRequest, `status must be "complete" or "incomplete"`)
	}
	if err != nil {
		return httpError(err)
	}
	return c.JSON(http.StatusOK, newPartyResponse(party))
}
