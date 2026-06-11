package rsvps

import (
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// This file is the single home for the package's request and response types:
// handlers never use anonymous structs, echo.Map, or map[string]any. Each
// payload doubles as the service input.
//
// Unlike the admin packages, the guest-facing guest view does not embed
// models.Guest: the model carries admin-only fields (tags, table/seat
// assignments, contact details of other party members' rows) that the RSVP
// flow has no business exposing, so RSVPGuest names exactly the fields the
// form needs. Events are not sensitive to an invited party, so RSVPEventGroup
// still embeds models.Event by value (a plain `extends models.Event`).

// RSVPGuest is the guest-facing view of one party member: enough to render an
// RSVP form row (name, the editable-name placeholder flag, and dietary
// restrictions) and nothing more.
type RSVPGuest struct {
	ID                  string  `json:"id"`
	FullName            string  `json:"full_name"`
	IsPlaceholder       bool    `json:"is_placeholder"`
	DietaryRestrictions *string `json:"dietary_restrictions"`
}

// RSVPEntry is one guest's current response to the enclosing event.
type RSVPEntry struct {
	GuestID string `json:"guest_id"`
	Status  string `json:"status" tstype:"models.EventRSVPStatus"`
}

// RSVPEventGroup is one event the party is invited to, with every party
// member's Event RSVP for it (a row is the invitation, ADR 0002, so each entry
// also means "this guest is invited").
type RSVPEventGroup struct {
	models.Event `tstype:",extends"`
	RSVPs        []RSVPEntry `json:"rsvps"`
}

// PartyRSVPsResponse is the body of GET /api/guest/rsvp (and of a successful
// PUT, which returns the refreshed state): the authenticated party's guests,
// its Event RSVPs grouped by event in schedule order, and the deadline state.
// The party's name is deliberately absent: it is an internal admin label for
// identifying groups, not something guests should see. Closed sends the form
// page to the read-only confirmation; ContactEmail (the app setting, nil when
// unset) feeds the post-deadline "contact us" message.
type PartyRSVPsResponse struct {
	Guests []RSVPGuest      `json:"guests"`
	Events []RSVPEventGroup `json:"events"`
	// Responded reports whether the party has answered at all: true once any
	// of its Event RSVP rows carries a response (a non-nil rsvped_at), false
	// while every row is still pending. The code-entry page uses it to route a
	// returning party to the confirmation summary instead of the form.
	Responded    bool       `json:"responded"`
	Closed       bool       `json:"closed"`
	RSVPDeadline *time.Time `json:"rsvp_deadline"`
	ContactEmail *string    `json:"contact_email"`
}

// UpdatePartyRSVPsPayload is the body of PUT /api/guest/rsvp: the whole form
// submitted at once. Only the guests included are touched; every included
// guest must belong to the authenticated party.
type UpdatePartyRSVPsPayload struct {
	Guests []GuestRSVPUpdate `json:"guests" mod:"dive" validate:"required,min=1,dive"`
}

// GuestRSVPUpdate carries one guest's submission. full_name fills in a
// placeholder guest's real name and is ignored for non-placeholders (real
// names are admin-managed); a blank value is also ignored, so a placeholder is
// never blanked back out. dietary_restrictions is full-state: it is stored as
// sent, so null (or blank) clears it. rsvps may name only events the guest
// holds an Event RSVP row for (the row is the invitation, ADR 0002).
type GuestRSVPUpdate struct {
	GuestID             string            `json:"guest_id" validate:"required,uuid"`
	FullName            *string           `json:"full_name" mod:"trim" validate:"omitempty,max=200"`
	DietaryRestrictions *string           `json:"dietary_restrictions" mod:"trim" validate:"omitempty,max=1000"`
	RSVPs               []EventRSVPUpdate `json:"rsvps" mod:"dive" validate:"omitempty,dive"`
}

// EventRSVPUpdate sets one guest's status for one event. pending is a legal
// target (a guest may withdraw an answer before the deadline), mirroring the
// admin override.
type EventRSVPUpdate struct {
	EventID string `json:"event_id" validate:"required,uuid"`
	Status  string `json:"status" validate:"required,oneof=pending attending not_attending" tstype:"models.EventRSVPStatus"`
}
