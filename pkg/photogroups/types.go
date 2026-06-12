package photogroups

import "github.com/robinjoseph08/robinandmadeline.com/pkg/models"

// This file is the single home for the package's request, response, and query
// types: handlers never use anonymous structs, echo.Map, or map[string]any.
// Each payload doubles as the service input.

// CreatePhotoGroupPayload is the body for POST /photo-groups. The group is
// born at the end of its event's shooting order (sort_order = max + 1); the
// reorder endpoint is the only way to change positions. event_id must name an
// existing event (422 otherwise; an event is picked from a list in the admin
// UI, so a stale id is a payload problem, not a missing resource).
type CreatePhotoGroupPayload struct {
	EventID string `json:"event_id" mod:"trim" validate:"required,uuid"`
	Name    string `json:"name" mod:"trim" validate:"required,max=200"`
}

// UpdatePhotoGroupPayload is the full desired state of a photo group's
// editable fields (PUT-style). Name is the only editable field: the owning
// event is part of the group's identity, and sort_order changes only through
// the reorder endpoint, which rewrites the event's whole sequence at once.
type UpdatePhotoGroupPayload struct {
	Name string `json:"name" mod:"trim" validate:"required,max=200"`
}

// ReorderPhotoGroupsPayload is the body for POST /photo-groups/reorder: the
// event's photo groups in their new shooting order. The ids must be exactly
// the event's groups (every one, no extras, no duplicates; 422 otherwise) so a
// reorder can never silently drop or duplicate a position.
type ReorderPhotoGroupsPayload struct {
	EventID       string   `json:"event_id" mod:"trim" validate:"required,uuid"`
	PhotoGroupIDs []string `json:"photo_group_ids" validate:"required,min=1,dive,uuid"`
}

// AddPhotoGroupGuestPayload is the body for POST /photo-groups/:id/guests: the
// guest to add to the group. guest_id must name an existing guest (422
// otherwise). Re-adding a guest already in the group is an idempotent no-op.
type AddPhotoGroupGuestPayload struct {
	GuestID string `json:"guest_id" mod:"trim" validate:"required,uuid"`
}

// ListPhotoGroupsQuery is the photo-group list filter, bound from the query
// string. event_id narrows the list to one event; absent, the list holds every
// event's groups (the admin page renders all events' shot lists at once).
type ListPhotoGroupsQuery struct {
	EventID *string `query:"event_id" json:"event_id" validate:"omitempty,uuid"`
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
