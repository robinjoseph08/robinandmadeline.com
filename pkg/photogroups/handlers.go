package photogroups

import (
	"net/http"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/auth"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// handler holds the dependencies for the photo-groups HTTP handlers. It is
// unexported; routes are wired via RegisterRoutes / RegisterGuestRoutes.
// Handlers return errcodes errors directly (and the *Error the service
// produces flows through), which the shared error handler renders. There is
// no per-package error translation.
type handler struct {
	service *Service
}

// pathID returns the named route param when it parses as a UUID, or a 404
// naming the given resource otherwise. Ids are UUIDs, so a malformed one can
// never name an existing row; without this check it would reach Postgres as a
// failing text-to-uuid cast and render a 500 instead of the 404 a missing row
// gets. The id is returned in canonical form so the query sees exactly what
// was parsed.
func pathID(c echo.Context, param, resource string) (string, error) {
	id, err := uuid.Parse(c.Param(param))
	if err != nil {
		return "", errcodes.NotFound(resource)
	}
	return id.String(), nil
}

// listPhotoGroups handles GET /api/admin/photo-groups: every photo group in
// shooting order, each with its members, in the uniform {items, total}
// envelope.
func (h *handler) listPhotoGroups(c echo.Context) error {
	return h.respondWithList(c)
}

// createPhotoGroup handles POST /api/admin/photo-groups, returning 201 with
// the created group (born memberless at the end of the shooting order).
func (h *handler) createPhotoGroup(c echo.Context) error {
	var body CreatePhotoGroupPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	return h.respondWithGroup(c, http.StatusCreated, func() (*models.PhotoGroup, error) {
		return h.service.CreatePhotoGroup(c.Request().Context(), body)
	})
}

// updatePhotoGroup handles PUT /api/admin/photo-groups/:id, the full-state
// update of the group's editable fields (its name).
func (h *handler) updatePhotoGroup(c echo.Context) error {
	id, err := pathID(c, "id", "photo group")
	if err != nil {
		return err
	}
	var body UpdatePhotoGroupPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	return h.respondWithGroup(c, http.StatusOK, func() (*models.PhotoGroup, error) {
		return h.service.UpdatePhotoGroup(c.Request().Context(), id, body)
	})
}

// deletePhotoGroup handles DELETE /api/admin/photo-groups/:id, returning 204
// on success. The group's assignments go with it via the FK cascade.
func (h *handler) deletePhotoGroup(c echo.Context) error {
	id, err := pathID(c, "id", "photo group")
	if err != nil {
		return err
	}
	if err := h.service.DeletePhotoGroup(c.Request().Context(), id); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// reorderPhotoGroups handles POST /api/admin/photo-groups/reorder: rewrites
// the shooting order from the payload's id sequence. It returns the groups in
// their new order (the same shape as the list endpoint), the authoritative
// result of the write for any caller.
func (h *handler) reorderPhotoGroups(c echo.Context) error {
	var body ReorderPhotoGroupsPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	if err := h.service.ReorderPhotoGroups(c.Request().Context(), body); err != nil {
		return err
	}
	return h.respondWithList(c)
}

// addGuest handles POST /api/admin/photo-groups/:id/guests: adds one guest to
// the group (an idempotent no-op when already a member). It returns the group
// with its refreshed member list, the authoritative result of the write for
// any caller.
func (h *handler) addGuest(c echo.Context) error {
	id, err := pathID(c, "id", "photo group")
	if err != nil {
		return err
	}
	var body AddPhotoGroupGuestPayload
	if err := c.Bind(&body); err != nil {
		return errors.WithStack(err)
	}
	return h.respondWithGroup(c, http.StatusOK, func() (*models.PhotoGroup, error) {
		return h.service.AddGuest(c.Request().Context(), id, body)
	})
}

// removeGuest handles DELETE /api/admin/photo-groups/:id/guests/:guestId,
// returning 204 on success. The assignment is addressed by its natural key
// (group, guest); a guest not in the group is a 404, since there is no
// membership to remove.
func (h *handler) removeGuest(c echo.Context) error {
	id, err := pathID(c, "id", "photo group")
	if err != nil {
		return err
	}
	guestID, err := pathID(c, "guestId", "photo group assignment")
	if err != nil {
		return err
	}
	if err := h.service.RemoveGuest(c.Request().Context(), id, guestID); err != nil {
		return err
	}
	return c.NoContent(http.StatusNoContent)
}

// listPartyPhotoGroups handles GET /api/guest/photo-groups, the guest-facing
// view. The route sits behind RequireGuest, whose party_id claim scopes the
// read: the response holds the groups the party's guests are in, each naming
// exactly which of the party's guests it needs.
func (h *handler) listPartyPhotoGroups(c echo.Context) error {
	items, err := h.service.PartyPhotoGroups(c.Request().Context(), auth.GuestPartyID(c))
	if err != nil {
		return err
	}
	return c.JSON(http.StatusOK, ListPartyPhotoGroupsResponse{Items: items, Total: len(items)})
}

// respondWithList renders every group in shooting order with its members in
// the uniform {items, total} envelope, the shape the list endpoint and the
// reorder response share.
func (h *handler) respondWithList(c echo.Context) error {
	ctx := c.Request().Context()
	list, total, err := h.service.ListPhotoGroups(ctx)
	if err != nil {
		return err
	}
	ids := make([]string, 0, len(list))
	for _, g := range list {
		ids = append(ids, g.ID)
	}
	assignments, err := h.service.AssignmentsForGroups(ctx, ids)
	if err != nil {
		return err
	}
	items := make([]PhotoGroupResponse, 0, len(list))
	for _, g := range list {
		items = append(items, newPhotoGroupResponse(g, assignments[g.ID]))
	}
	return c.JSON(http.StatusOK, ListPhotoGroupsResponse{Items: items, Total: total})
}

// respondWithGroup runs a group write/read and renders the group with its
// member list, the shape every single-group endpoint shares.
func (h *handler) respondWithGroup(c echo.Context, status int, op func() (*models.PhotoGroup, error)) error {
	group, err := op()
	if err != nil {
		return err
	}
	assignments, err := h.service.AssignmentsForGroups(c.Request().Context(), []string{group.ID})
	if err != nil {
		return err
	}
	return c.JSON(status, newPhotoGroupResponse(group, assignments[group.ID]))
}
