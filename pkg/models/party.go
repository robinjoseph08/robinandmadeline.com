// Package models holds the persistent Bun models and their domain logic. It is
// import-clean (only stdlib, bun, and uuid) so any feature package can depend on
// it without cycles. Closed enum value sets and their generated TypeScript
// unions live here too, next to the fields that use them.
package models

import (
	"context"
	"strings"
	"time"

	"github.com/uptrace/bun"
)

// Party implements bun's BeforeAppendModel so the hook below fires on every
// insert and update.
var _ bun.BeforeAppendModelHook = (*Party)(nil)

// Closed enum-like value sets stored as TEXT and guarded by CHECK constraints in
// the schema. The //tygo:emit lines generate matching TypeScript unions.
const (
	//tygo:emit export type Side = typeof SideRobin | typeof SideMadeline;
	SideRobin    = "robin"
	SideMadeline = "madeline"

	//tygo:emit export type Relation = typeof RelationFamily | typeof RelationFriend;
	RelationFamily = "family"
	RelationFriend = "friend"

	//tygo:emit export type InvitationType = typeof InvitationPhysical | typeof InvitationDigital;
	InvitationPhysical = "physical"
	InvitationDigital  = "digital"

	//tygo:emit export type Circle = typeof CircleImmediate | typeof CircleExtended | typeof CircleCollege | typeof CircleWork | typeof CircleChildhood | typeof CircleOther;
	CircleImmediate = "Immediate"
	CircleExtended  = "Extended"
	CircleCollege   = "College"
	CircleWork      = "Work"
	CircleChildhood = "Childhood"
	CircleOther     = "Other"
)

// Info-collection status values. Status is derived, never stored (ADR 0005).
const (
	//tygo:emit export type InfoCollectionStatus = typeof StatusComplete | typeof StatusIncomplete;
	StatusComplete   = "complete"
	StatusIncomplete = "incomplete"
)

// countryUS is the canonical mailing country whose addresses are gated on a
// postal code. Any other country, and a not-yet-known (blank) one, skips that
// gate, since many countries have no postal code at all.
const countryUS = "United States"

// Party is a group that receives a single invitation and shares one mailing
// address and one RSVP code.
//
// Nullable columns (the address fields and rsvp_code) are pointers so "absent"
// is distinguishable from "empty string". circle is a Postgres text[] via the
// bun ",array" tag. The two info_collection_* booleans are the stored state
// behind the derived status; the status itself is computed (see
// InfoCollectionStatus).
type Party struct {
	bun.BaseModel `bun:"table:parties,alias:p" tstype:"-"`

	ID              string   `bun:"id,pk" json:"id"`
	Name            string   `bun:"name" json:"name"`
	Side            string   `bun:"side" json:"side" tstype:"Side"`
	Relation        string   `bun:"relation" json:"relation" tstype:"Relation"`
	Circle          []string `bun:"circle,array" json:"circle" tstype:"Circle[]"`
	InvitationType  string   `bun:"invitation_type" json:"invitation_type" tstype:"InvitationType"`
	AddressLine1    *string  `bun:"address_line_1" json:"address_line_1"`
	AddressLine2    *string  `bun:"address_line_2" json:"address_line_2"`
	City            *string  `bun:"city" json:"city"`
	StateOrProvince *string  `bun:"state_or_province" json:"state_or_province"`
	PostalCode      *string  `bun:"postal_code" json:"postal_code"`
	Country         *string  `bun:"country" json:"country"`

	InfoToken string  `bun:"info_token" json:"info_token"`
	RSVPCode  *string `bun:"rsvp_code" json:"rsvp_code"`

	// InfoCollectionRequested records that the info link was sent, delegating
	// collection to the guest. InfoCollectionConfirmed records that the data was
	// affirmed (guest submitted the form, or admin marked complete). Together
	// they drive the derived status; see ADR 0005.
	InfoCollectionRequested bool `bun:"info_collection_requested" json:"info_collection_requested"`
	InfoCollectionConfirmed bool `bun:"info_collection_confirmed" json:"info_collection_confirmed"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`

	// Guests is populated only when explicitly loaded; the status methods require
	// it. It is not a stored column; bun fills it via relation queries.
	Guests []*Guest `bun:"rel:has-many,join:id=party_id" json:"guests,omitempty" tstype:"Guest[]"`
}

// BeforeAppendModel normalizes a nil Circle to an empty (non-nil) slice before
// any insert or update so the NOT NULL circle text[] column always stores '{}'
// rather than NULL. This is the single, code-path-independent enforcement point
// for the slice invariant: the binder's `default:"[]"` covers the HTTP path, and
// this hook covers direct service calls (e.g. tests, internal callers). bun
// invokes it on INSERT and UPDATE queries.
func (p *Party) BeforeAppendModel(_ context.Context, query bun.Query) error {
	switch query.(type) {
	case *bun.InsertQuery, *bun.UpdateQuery:
		if p.Circle == nil {
			p.Circle = []string{}
		}
	}
	return nil
}

// PrimaryGuest returns the party's primary guest, or nil when none is loaded or
// assigned. The Guests relation must be loaded by the caller.
func (p *Party) PrimaryGuest() *Guest {
	for _, g := range p.Guests {
		if g.IsPrimary {
			return g
		}
	}
	return nil
}

// InfoCollectionStatus derives the party's info-collection status from its
// stored flags and the presence of its required fields (ADR 0005):
//
//   - requested=false: status is DERIVED from the data alone, complete iff all
//     required fields are present. The confirmed flag is ignored so stale data
//     never reads as affirmed.
//   - requested=true: status is AFFIRMED, complete iff confirmed=true. Because
//     confirmed can only be set when required fields are present, a complete
//     affirmed party necessarily has its required fields too.
//
// In both branches a party is complete only when its required fields are
// present. Requires the Guests relation to be loaded; a party with no loaded or
// assigned primary reads incomplete.
func (p *Party) InfoCollectionStatus() string {
	if p.InfoCollectionRequested {
		if p.InfoCollectionConfirmed {
			return StatusComplete
		}
		return StatusIncomplete
	}
	if p.RequiredFieldsPresent() {
		return StatusComplete
	}
	return StatusIncomplete
}

// RequiredFieldsPresent reports whether the party has every field required to be
// markable complete: the primary guest's email always, plus a full mailing
// address for physical parties (the address is irrelevant for digital). This is
// the single completion gate; confirmed may be set true only when it holds. It
// is defined as MissingRequiredFields being empty, so the gate and the admin
// UI's "what's missing" hint can never disagree. Requires the Guests relation
// to be loaded.
func (p *Party) RequiredFieldsPresent() bool {
	return len(p.MissingRequiredFields()) == 0
}

// MissingRequiredFields lists, as human-readable labels, the required fields
// the party still lacks: the primary guest's email always, plus each absent
// mailing-address field for physical parties (address line 2 is optional, and
// the postal code is required only for a US address). The itemized counterpart
// of RequiredFieldsPresent. The result is never nil, so it serializes as []
// rather than null. Requires the Guests relation to be loaded.
func (p *Party) MissingRequiredFields() []string {
	missing := []string{}
	if !p.primaryEmailPresent() {
		missing = append(missing, "primary guest's email")
	}
	if p.InvitationType != InvitationPhysical {
		return missing
	}
	mailedToUS := p.mailedToUS()
	for _, field := range []struct {
		value          *string
		label          string
		optionalAbroad bool
	}{
		{p.AddressLine1, "address line 1", false},
		{p.City, "city", false},
		{p.StateOrProvince, "state or province", false},
		{p.PostalCode, "postal code", true},
		{p.Country, "country", false},
	} {
		// A postal code is required only for a US address: many countries (Hong
		// Kong, the UAE, Qatar, ...) have none, so a non-US (or not-yet-known)
		// party isn't gated on it.
		if field.optionalAbroad && !mailedToUS {
			continue
		}
		if !nonBlank(field.value) {
			missing = append(missing, field.label)
		}
	}
	return missing
}

// mailedToUS reports whether the party's mailing country is the United States,
// the only country whose addresses require a postal code. A blank or
// not-yet-known country counts as not-US: until the guest tells us where they
// are, we don't force a postal code they may not have. Compared
// case-insensitively so a lowercased "united states" still matches.
func (p *Party) mailedToUS() bool {
	return p.Country != nil && strings.EqualFold(strings.TrimSpace(*p.Country), countryUS)
}

// primaryEmailPresent reports whether the loaded primary guest has a non-blank
// email. A party with no primary reports false.
func (p *Party) primaryEmailPresent() bool {
	primary := p.PrimaryGuest()
	return primary != nil && primary.Email != nil && strings.TrimSpace(*primary.Email) != ""
}

// nonBlank reports whether a nullable string is present and not just whitespace.
func nonBlank(s *string) bool {
	return s != nil && strings.TrimSpace(*s) != ""
}
