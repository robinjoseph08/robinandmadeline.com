package info

import "github.com/robinjoseph08/robinandmadeline.com/pkg/models"

// This file is the single home for the package's request and response types:
// handlers never use anonymous structs, echo.Map, or map[string]any. Each
// payload doubles as the service input.
//
// Like the RSVP flow, the guest-facing guest view does not embed models.Guest:
// the model carries admin-only fields (tags, table/seat assignments) that the
// info form has no business exposing, so Guest names exactly the fields
// the form needs. The party name is deliberately absent from the response: it
// is an internal admin label for identifying groups, never shown to guests
// (CONTEXT.md); the page greets the party by its members' names instead.

// Guest is the guest-facing view of one party member for the info form:
// the editable identity (name, with the placeholder descriptor for plus-one
// slots) and the contact details being collected. is_primary tells the form
// which guest's email is required and which guests carry a remove action (the
// primary cannot be removed).
type Guest struct {
	ID              string  `json:"id"`
	FullName        string  `json:"full_name"`
	IsPrimary       bool    `json:"is_primary"`
	PlaceholderText *string `json:"placeholder_text"`
	Email           *string `json:"email"`
	Phone           *string `json:"phone"`
}

// PartyInfoResponse is the body of GET /api/info/:token (and of a successful
// PUT, which returns the refreshed state): the party's invitation type (which
// decides whether the address section is required or hidden), its mailing
// address, and every guest with their current contact details.
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
// included are touched; every included guest must belong to the token's party.
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
// full_name corrects a regular guest's name (the import only had a best
// approximation): a non-blank value is stored, an absent one leaves the name
// untouched, and a present-but-blank value is rejected (422), so a name can
// be corrected but never cleared. For a placeholder guest (a non-null
// placeholder_text) it follows the RSVP form's rule instead: a non-blank
// value names the slot without erasing the descriptor, a present-but-blank
// value reverts the slot to unnamed (full_name back to the descriptor), and
// an absent value leaves the name untouched.
//
// email and phone are full-state for an included guest: they are stored as
// sent, with blank (or absent) clearing to SQL NULL. The completion gate is
// what keeps the primary's email from being cleared away (the submit would be
// a 422).
//
// remove drops the guest from the party entirely (an ex significant other, a
// child who definitely won't come, or a +1 the party gives up): the guest and
// their Event RSVPs are deleted. The primary guest cannot be removed (422).
// When remove is set the other fields are ignored.
type GuestInfoUpdate struct {
	GuestID  string  `json:"guest_id" validate:"required,uuid"`
	FullName *string `json:"full_name" mod:"trim" validate:"omitempty,max=200"`
	Email    *string `json:"email" mod:"trim" validate:"omitempty,emailblank,max=320"`
	Phone    *string `json:"phone" mod:"trim,phone" validate:"omitempty,phone,max=32"`
	Remove   bool    `json:"remove"`
}

// newGuestView projects a loaded guest model onto its guest-facing view.
func newGuestView(g *models.Guest) Guest {
	return Guest{
		ID:              g.ID,
		FullName:        g.FullName,
		IsPrimary:       g.IsPrimary,
		PlaceholderText: g.PlaceholderText,
		Email:           g.Email,
		Phone:           g.Phone,
	}
}
