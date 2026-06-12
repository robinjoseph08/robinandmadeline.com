package photogroups

import "github.com/robinjoseph08/robinandmadeline.com/pkg/models"

// This file is the single home for the package's request and response types:
// handlers never use anonymous structs, echo.Map, or map[string]any. Each
// payload doubles as the service input.

// CreatePhotoGroupPayload is the body for POST /photo-groups. The group is
// born at the end of the shooting order (sort_order = max + 1); the reorder
// endpoint is the only way to change positions.
type CreatePhotoGroupPayload struct {
	Name string `json:"name" mod:"trim" validate:"required,max=200"`
}

// UpdatePhotoGroupPayload is the full desired state of a photo group's
// editable fields (PUT-style). Name is the only editable field: sort_order
// changes only through the reorder endpoint, which rewrites the whole
// sequence at once.
type UpdatePhotoGroupPayload struct {
	Name string `json:"name" mod:"trim" validate:"required,max=200"`
}

// ReorderPhotoGroupsPayload is the body for POST /photo-groups/reorder: every
// photo group in its new shooting order. The ids must be exactly the existing
// groups (every one, no extras, no duplicates; 422 otherwise) so a reorder
// can never silently drop or duplicate a position.
type ReorderPhotoGroupsPayload struct {
	PhotoGroupIDs []string `json:"photo_group_ids" validate:"required,min=1,dive,uuid"`
}

// AddPhotoGroupGuestPayload is the body for POST /photo-groups/:id/guests: the
// guest to add to the group. guest_id must name an existing guest (422
// otherwise). Re-adding a guest already in the group is an idempotent no-op.
type AddPhotoGroupGuestPayload struct {
	GuestID string `json:"guest_id" mod:"trim" validate:"required,uuid"`
}

// PhotoGroupGuest is one member of a photo group in the admin API: the guest's
// id and name plus the owning party's id and name, so the admin UI can show
// who is in the group and link back to the party page.
type PhotoGroupGuest struct {
	GuestID   string `json:"guest_id"`
	GuestName string `json:"guest_name"`
	PartyID   string `json:"party_id"`
	PartyName string `json:"party_name"`
}

// PhotoGroupResponse is the API representation of a photo group: the stored
// model plus its members. The model is embedded by value so tygo flattens it
// into a plain `extends models.PhotoGroup` (see parties.PartyResponse for why
// a pointer embed would be wrong). guests always serializes as a list, never
// null.
type PhotoGroupResponse struct {
	models.PhotoGroup `tstype:",extends"`
	Guests            []PhotoGroupGuest `json:"guests"`
}

// ListPhotoGroupsResponse is the uniform list envelope for photo groups.
type ListPhotoGroupsResponse struct {
	Items []PhotoGroupResponse `json:"items"`
	Total int                  `json:"total"`
}

// PartyPhotoGroup is one photo group on the guest-facing view (GET
// /api/guest/photo-groups): a group someone in the authenticated party is in.
// Position is the group's 1-based rank in the shooting order and Total the
// overall group count, both spanning ALL groups (not just the party's), so
// the page can say "group 3 of 12"; Position is a computed rank, not the raw
// sort_order, which may have gaps after deletes. GuestNames holds the full
// names of THIS party's guests in the group (never another party's), in party
// order, so the page can call out exactly who is needed.
type PartyPhotoGroup struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Position   int      `json:"position"`
	Total      int      `json:"total"`
	GuestNames []string `json:"guest_names"`
}

// ListPartyPhotoGroupsResponse is the body of GET /api/guest/photo-groups,
// the uniform list envelope for the authenticated party's photo groups.
type ListPartyPhotoGroupsResponse struct {
	Items []PartyPhotoGroup `json:"items"`
	Total int               `json:"total"`
}

// newPhotoGroupResponse wraps a photo group and its loaded assignments for the
// API. Each assignment's Guest relation (and the guest's Party) must be
// loaded; missing relations fall back to empty strings rather than panicking.
func newPhotoGroupResponse(g *models.PhotoGroup, assignments []*models.PhotoGroupAssignment) PhotoGroupResponse {
	guests := make([]PhotoGroupGuest, 0, len(assignments))
	for _, a := range assignments {
		member := PhotoGroupGuest{GuestID: a.GuestID}
		if a.Guest != nil {
			member.GuestName = a.Guest.FullName
			member.PartyID = a.Guest.PartyID
			if a.Guest.Party != nil {
				member.PartyName = a.Guest.Party.Name
			}
		}
		guests = append(guests, member)
	}
	return PhotoGroupResponse{PhotoGroup: *g, Guests: guests}
}
