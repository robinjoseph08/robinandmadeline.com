package events

import "github.com/robinjoseph08/robinandmadeline.com/pkg/models"

// This file is the single home for the package's request, response, query, and
// enum-carrying payload types: handlers never use anonymous structs, echo.Map,
// or map[string]any. Each payload doubles as the service input.

// CreateEventPayload is the body for POST /events. date is the calendar day as
// "YYYY-MM-DD" (the custom date validator checks the format; required rejects
// blank). start_time/end_time are optional zero-padded "HH:MM" 24-hour
// strings (the custom time validator; the padding keeps lexical order
// chronological for the schedule's ORDER BY and the values fixed-width for
// calendar formats). is_public decides invitation semantics (ADR 0002):
// creating a public event backfills a pending Event RSVP for every existing
// guest in the same transaction.
type CreateEventPayload struct {
	Name        string  `json:"name" mod:"trim" validate:"required,max=200"`
	Description *string `json:"description" mod:"trim" validate:"omitempty,max=2000"`
	Location    *string `json:"location" mod:"trim" validate:"omitempty,max=500"`
	Date        string  `json:"date" mod:"trim" validate:"required,date"`
	StartTime   *string `json:"start_time" mod:"trim" validate:"omitempty,time"`
	EndTime     *string `json:"end_time" mod:"trim" validate:"omitempty,time"`
	IsPublic    bool    `json:"is_public"`
}

// UpdateEventPayload is the full desired state of an event's editable fields
// (PUT-style), mirroring CreateEventPayload. Flipping is_public from false to
// true backfills pending Event RSVPs for every guest (restoring the ADR 0002
// invariant); flipping it to private leaves the existing rows untouched, so no
// response is ever lost to a visibility toggle.
type UpdateEventPayload struct {
	Name        string  `json:"name" mod:"trim" validate:"required,max=200"`
	Description *string `json:"description" mod:"trim" validate:"omitempty,max=2000"`
	Location    *string `json:"location" mod:"trim" validate:"omitempty,max=500"`
	Date        string  `json:"date" mod:"trim" validate:"required,date"`
	StartTime   *string `json:"start_time" mod:"trim" validate:"omitempty,time"`
	EndTime     *string `json:"end_time" mod:"trim" validate:"omitempty,time"`
	IsPublic    bool    `json:"is_public"`
}

// InvitePartiesPayload is the body for POST /events/:id/invite: the parties to
// invite to a private event. Every id must be a UUID; the service additionally
// requires each to name an existing party (422 otherwise) and the event to be
// private (a public event already invites everyone). Inviting a party creates
// a pending Event RSVP for each of its guests, skipping guests already
// invited, so re-inviting is idempotent.
type InvitePartiesPayload struct {
	PartyIDs []string `json:"party_ids" validate:"required,min=1,dive,uuid"`
}

// UpdateEventRSVPPayload is the body for the admin RSVP override (PUT
// /events/:id/rsvps/:guestId): the new status for one guest's Event RSVP. The
// service stamps rsvped_at for a response (attending / not_attending) and
// clears it when the row is reset to pending.
type UpdateEventRSVPPayload struct {
	Status string `json:"status" validate:"required,oneof=pending attending not_attending" tstype:"models.EventRSVPStatus"`
}

// RSVPBreakdown is an event's tally of Event RSVP rows by status. Because a
// row is the invitation (ADR 0002), total is also the number of invited
// guests.
type RSVPBreakdown struct {
	Pending      int `json:"pending"`
	Attending    int `json:"attending"`
	NotAttending int `json:"not_attending"`
	Total        int `json:"total"`
}

// EventResponse is the API representation of an event: the stored model plus
// its derived RSVP breakdown. The model is embedded by value so tygo flattens
// it into a plain `extends models.Event` (see parties.PartyResponse for why a
// pointer embed would be wrong).
type EventResponse struct {
	models.Event  `tstype:",extends"`
	RSVPBreakdown RSVPBreakdown `json:"rsvp_breakdown"`
}

// ListEventsResponse is the uniform list envelope for events.
type ListEventsResponse struct {
	Items []EventResponse `json:"items"`
	Total int             `json:"total"`
}

// SchedulePhotoGroup is one photo group assignment on the guest-facing
// schedule: a named photo session someone in the authenticated guest's party
// is part of at an event. Position is the group's 1-based rank in the event's
// shooting order and Total the event's group count, both spanning ALL of the
// event's groups (not just the party's), so the page can say "group 3 of 12".
// Position is a computed rank, not the raw sort_order, which may have gaps
// after deletes.
type SchedulePhotoGroup struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Position int    `json:"position"`
	Total    int    `json:"total"`
}

// ScheduleEvent is the guest-facing view of one event on the schedule: the
// stored model (embedded by value, like EventResponse) plus the authenticated
// guest's party's photo group assignments (always present; empty on the
// anonymous view and for events where the party has none). It deliberately
// omits the RSVP breakdown: attendance tallies are admin data the schedule has
// no business exposing.
type ScheduleEvent struct {
	models.Event `tstype:",extends"`
	PhotoGroups  []SchedulePhotoGroup `json:"photo_groups"`
}

// ListScheduleEventsResponse is the body of GET /api/events, the uniform list
// envelope for the guest-facing schedule.
type ListScheduleEventsResponse struct {
	Items []ScheduleEvent `json:"items"`
	Total int             `json:"total"`
}

// EventRSVPListItem is the API representation of one guest's Event RSVP in an
// event's RSVP list. It embeds the row by value (a plain `extends
// models.EventRSVP`) and adds the guest and party context the admin UI shows:
// the guest's name, and the owning party's id and name so rows can be grouped
// into invited parties and linked back to the party page.
type EventRSVPListItem struct {
	models.EventRSVP `tstype:",extends"`
	GuestName        string `json:"guest_name"`
	PartyID          string `json:"party_id"`
	PartyName        string `json:"party_name"`
}

// ListEventRSVPsResponse is the uniform list envelope for an event's RSVPs.
type ListEventRSVPsResponse struct {
	Items []EventRSVPListItem `json:"items"`
	Total int                 `json:"total"`
}

// newEventResponse wraps an event and its breakdown for the API.
func newEventResponse(e *models.Event, b RSVPBreakdown) EventResponse {
	return EventResponse{Event: *e, RSVPBreakdown: b}
}

// newEventRSVPListItem wraps an Event RSVP row for the API, carrying the
// guest's name and party. The row's Guest relation (and the guest's Party)
// must be loaded; missing relations fall back to empty strings rather than
// panicking.
func newEventRSVPListItem(r *models.EventRSVP) EventRSVPListItem {
	item := EventRSVPListItem{EventRSVP: *r}
	if r.Guest != nil {
		item.GuestName = r.Guest.FullName
		item.PartyID = r.Guest.PartyID
		if r.Guest.Party != nil {
			item.PartyName = r.Guest.Party.Name
		}
	}
	return item
}
