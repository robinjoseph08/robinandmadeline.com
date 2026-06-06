// Package parties is the data layer and admin API for parties and their guests:
// the wedding guest list. A Party receives one invitation and shares a mailing
// address and RSVP code; a Guest is one person in exactly one party. See
// CONTEXT.md for the full domain language.
//
// The package owns the info-collection status state machine (ADR 0005), whose
// rules live in one pure function (status.go) reused by API responses, the
// status list filter, and the mark-complete gate.
package parties

import (
	"time"

	"github.com/uptrace/bun"
)

// Enum-like values stored as TEXT and guarded by CHECK constraints in the
// schema. They are validated again at the app layer (see validate.go) so the
// API returns a friendly 400 rather than surfacing a raw constraint violation.
const (
	SideRobin    = "robin"
	SideMadeline = "madeline"

	RelationFamily = "family"
	RelationFriend = "friend"

	InvitationPhysical = "physical"
	InvitationDigital  = "digital"
)

// Info-collection status values. Status is derived, never stored (ADR 0005).
const (
	StatusComplete   = "complete"
	StatusIncomplete = "incomplete"
)

// Party is a group that receives a single invitation and shares one mailing
// address and one RSVP code.
//
// Nullable columns (the address fields and rsvp_code) are pointers so "absent"
// is distinguishable from "empty string". circle is a Postgres text[] via the
// bun ",array" tag. The two info_collection_* booleans are the stored state
// behind the derived status; the status itself is computed (see Status).
type Party struct {
	bun.BaseModel `bun:"table:parties,alias:p"`

	ID              string   `bun:"id,pk" json:"id"`
	Name            string   `bun:"name" json:"name"`
	Side            string   `bun:"side" json:"side"`
	Relation        string   `bun:"relation" json:"relation"`
	Circle          []string `bun:"circle,array" json:"circle"`
	InvitationType  string   `bun:"invitation_type" json:"invitation_type"`
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
	// they drive Status; see ADR 0005.
	InfoCollectionRequested bool `bun:"info_collection_requested" json:"info_collection_requested"`
	InfoCollectionConfirmed bool `bun:"info_collection_confirmed" json:"info_collection_confirmed"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`

	// Guests is populated only when explicitly loaded (e.g. for status
	// derivation, which needs the primary guest's email). It is not a stored
	// column; bun fills it via relation queries.
	Guests []*Guest `bun:"rel:has-many,join:id=party_id" json:"guests,omitempty"`
}

// Guest is an individual person belonging to exactly one party.
//
// email and phone are per-guest (the mailing address lives on the party).
// roles is a Postgres text[]. table_number / seat_number are nullable ints set
// during seating. is_primary is constrained to at most one true per party by a
// partial unique index and enforced transactionally by the service.
type Guest struct {
	bun.BaseModel `bun:"table:guests,alias:g"`

	ID       string   `bun:"id,pk" json:"id"`
	PartyID  string   `bun:"party_id" json:"party_id"`
	FullName string   `bun:"full_name" json:"full_name"`
	Email    *string  `bun:"email" json:"email"`
	Phone    *string  `bun:"phone" json:"phone"`
	Roles    []string `bun:"roles,array" json:"roles"`

	IsPrimary     bool `bun:"is_primary" json:"is_primary"`
	IsChild       bool `bun:"is_child" json:"is_child"`
	IsDrinking    bool `bun:"is_drinking" json:"is_drinking"`
	IsPlaceholder bool `bun:"is_placeholder" json:"is_placeholder"`

	DietaryRestrictions *string `bun:"dietary_restrictions" json:"dietary_restrictions"`
	TableNumber         *int    `bun:"table_number" json:"table_number"`
	SeatNumber          *int    `bun:"seat_number" json:"seat_number"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`
}
