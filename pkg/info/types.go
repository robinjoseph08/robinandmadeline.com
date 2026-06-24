package info

import "github.com/robinjoseph08/robinandmadeline.com/pkg/models"

// This file is the single home for the package's request and response types:
// handlers never use anonymous structs, echo.Map, or map[string]any. Each
// payload doubles as the service input.
//
// Like the RSVP flow, the guest-facing guest view does not embed models.Guest:
// the model carries admin-only fields (tags, table/seat assignments) that the
// info form has no business exposing, so Guest names exactly the fields the
// form needs. is_child is the one admin flag it surfaces, and not as data to
// display: the form reads it as a presentation signal, to decide whether to
// render the contact fields (the RSVP view has no such need, so it omits the
// flag). The party name is deliberately absent from the response: it is an
// internal admin label for identifying groups, never shown to guests
// (CONTEXT.md); the page greets the party by its members' names instead.

// Guest is the guest-facing view of one party member for the info form: the
// editable name and the contact details being collected. Placeholder guests
// (unnamed plus-one slots) never appear here: info collection is about people
// the couple already knows, and the slots only surface later, in the RSVP
// flow, so the view carries no placeholder descriptor at all. is_primary
// tells the form which guest's email is required and which guests carry a
// remove action (the primary cannot be removed); is_child drops the email and
// phone inputs for a child, who has no contact details of their own to collect
// (the primary keeps their email, which is always required).
type Guest struct {
	ID        string  `json:"id"`
	FullName  string  `json:"full_name"`
	IsPrimary bool    `json:"is_primary"`
	IsChild   bool    `json:"is_child"`
	Email     *string `json:"email"`
	Phone     *string `json:"phone"`
	// Subscribed seeds the email-updates checkbox shown beside the email field;
	// it is meaningful only alongside an email (ADR 0009).
	Subscribed bool `json:"subscribed"`
}

// PartyInfoResponse is the body of GET /api/info/:token (and of a successful
// PUT, which returns the refreshed state): the party's invitation type (which
// decides whether the address section is required or hidden), its mailing
// address, and every known (non-placeholder) guest with their current contact
// details.
type PartyInfoResponse struct {
	InvitationType  string  `json:"invitation_type" tstype:"models.InvitationType"`
	AddressLine1    *string `json:"address_line_1"`
	AddressLine2    *string `json:"address_line_2"`
	City            *string `json:"city"`
	StateOrProvince *string `json:"state_or_province"`
	PostalCode      *string `json:"postal_code"`
	Country         *string `json:"country"`
	Guests          []Guest `json:"guests"`
}

// UpdatePartyInfoPayload is the body of PUT /api/info/:token: the whole form
// submitted at once. Address fields are party-level (one envelope per party);
// a present field is stored (blank clears to NULL), an absent field is left
// untouched, so a digital party's form, which never renders the address
// section, cannot wipe an address the couple entered by hand. Only the guests
// included are touched; every included guest must be one of the token's
// party's known (non-placeholder) guests, since the info flow never exposes
// placeholder slots.
type UpdatePartyInfoPayload struct {
	AddressLine1    *string           `json:"address_line_1" mod:"trim" validate:"omitempty,max=200"`
	AddressLine2    *string           `json:"address_line_2" mod:"trim" validate:"omitempty,max=200"`
	City            *string           `json:"city" mod:"trim" validate:"omitempty,max=200"`
	StateOrProvince *string           `json:"state_or_province" mod:"trim" validate:"omitempty,max=200"`
	PostalCode      *string           `json:"postal_code" mod:"trim" validate:"omitempty,max=200"`
	Country         *string           `json:"country" mod:"trim" validate:"omitempty,max=200"`
	Guests          []GuestInfoUpdate `json:"guests" mod:"dive" validate:"required,min=1,dive"`
}

// GuestInfoUpdate carries one guest's submission.
//
// full_name corrects the guest's name (the import only had a best
// approximation): a non-blank value is stored, an absent one leaves the name
// untouched, and a present-but-blank value is rejected (422), so a name can
// be corrected but never cleared. Placeholder naming is an RSVP-flow concern;
// a placeholder guest cannot be addressed here at all (422, the same
// rejection as a guest from another party).
//
// email and phone are full-state for an included guest: they are stored as
// sent, with blank (or absent) clearing to SQL NULL. The completion gate is
// what keeps the primary's email from being cleared away (the submit would be
// a 422).
//
// remove drops the guest from the party entirely (an ex significant other, or
// a child who definitely won't come): the guest and their Event RSVPs are
// deleted. The primary guest cannot be removed (422). When remove is set the
// other fields are ignored.
type GuestInfoUpdate struct {
	GuestID  string  `json:"guest_id" validate:"required,uuid"`
	FullName *string `json:"full_name" mod:"trim" validate:"omitempty,max=200"`
	Email    *string `json:"email" mod:"trim" validate:"omitempty,emailblank,max=320"`
	Phone    *string `json:"phone" mod:"trim,phone" validate:"omitempty,phone,max=32"`
	// Subscribed sets the guest's email subscription (ADR 0009). A pointer so an
	// omitted value leaves the stored state untouched; the form always sends the
	// current checkbox state for an included guest, which keeps clearing an email
	// and unsubscribing independent (the primary's required email can stay on
	// file while they are unsubscribed).
	Subscribed *bool `json:"subscribed"`
	Remove     bool  `json:"remove"`
}

// newGuestView projects a loaded guest model onto its guest-facing view.
func newGuestView(g *models.Guest) Guest {
	return Guest{
		ID:         g.ID,
		FullName:   g.FullName,
		IsPrimary:  g.IsPrimary,
		IsChild:    g.IsChild,
		Email:      g.Email,
		Phone:      g.Phone,
		Subscribed: g.Subscribed,
	}
}
