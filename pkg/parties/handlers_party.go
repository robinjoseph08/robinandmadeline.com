package parties

import (
	"net/http"

	"github.com/labstack/echo/v4"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// listParties handles GET /api/admin/parties with optional query filters: side,
// relation, circle, invitation_type, info_collection_status,
// info_collection_requested. It returns the uniform {items, total} envelope.
func (h *handler) listParties(c echo.Context) error {
	q := ListPartiesQuery{
		Side:                    queryStrPtr(c, "side"),
		Relation:                queryStrPtr(c, "relation"),
		Circle:                  queryStrPtr(c, "circle"),
		InvitationType:          queryStrPtr(c, "invitation_type"),
		InfoCollectionStatus:    queryStrPtr(c, "info_collection_status"),
		InfoCollectionRequested: queryBoolPtr(c, "info_collection_requested"),
	}

	parties, total, err := h.service.ListParties(c.Request().Context(), q)
	if err != nil {
		return err
	}
	items := make([]PartyResponse, 0, len(parties))
	for _, p := range parties {
		items = append(items, newPartyResponse(p))
	}
	return c.JSON(http.StatusOK, ListPartiesResponse{Items: items, Total: total})
}

// getParty handles GET /api/admin/parties/:id.
func (h *handler) getParty(c echo.Context) error {
	party, err := h.service.GetParty(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, newPartyResponse(party))
}

// createParty handles POST /api/admin/parties, returning 201 with the created
// party (including its generated info token and derived status).
func (h *handler) createParty(c echo.Context) error {
	var body CreatePartyPayload
	if err := c.Bind(&body); err != nil {
		return errcodes.BadRequest("invalid request body")
	}

	party, err := h.service.CreateParty(c.Request().Context(), body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusCreated, newPartyResponse(party))
}

// updateParty handles PUT /api/admin/parties/:id. It replaces the editable
// fields and never alters the info token or collection status.
func (h *handler) updateParty(c echo.Context) error {
	var body UpdatePartyPayload
	if err := c.Bind(&body); err != nil {
		return errcodes.BadRequest("invalid request body")
	}

	party, err := h.service.UpdateParty(c.Request().Context(), c.Param("id"), body)
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, newPartyResponse(party))
}

// deleteParty handles DELETE /api/admin/parties/:id, returning 204 on success.
func (h *handler) deleteParty(c echo.Context) error {
	if err := h.service.DeleteParty(c.Request().Context(), c.Param("id")); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// requestInfo handles POST /api/admin/parties/:id/request-info, marking the info
// link as sent (requested=true, confirmed=false) and resetting status to
// waiting.
func (h *handler) requestInfo(c echo.Context) error {
	party, err := h.service.RequestInfo(c.Request().Context(), c.Param("id"))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, newPartyResponse(party))
}

// markInfo handles POST /api/admin/parties/:id/mark-info. With status=complete
// it gates on required fields (422 if missing); with status=incomplete it
// re-opens the party.
func (h *handler) markInfo(c echo.Context) error {
	var body MarkInfoPayload
	if err := c.Bind(&body); err != nil {
		return errcodes.BadRequest("invalid request body")
	}

	ctx := c.Request().Context()
	id := c.Param("id")

	var (
		party *models.Party
		err   error
	)
	switch body.Status {
	case models.StatusComplete:
		party, err = h.service.MarkComplete(ctx, id)
	case models.StatusIncomplete:
		party, err = h.service.MarkIncomplete(ctx, id)
	default:
		return errcodes.BadRequest(`status must be "complete" or "incomplete"`)
	}
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, newPartyResponse(party))
}
