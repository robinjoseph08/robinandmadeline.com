package models

import (
	"context"
	"time"

	"github.com/uptrace/bun"
)

// Guest implements bun's BeforeAppendModel so the hook below fires on every
// insert and update.
var _ bun.BeforeAppendModelHook = (*Guest)(nil)

// Guest is an individual person belonging to exactly one party.
//
// email and phone are per-guest (the mailing address lives on the party). tags
// is a Postgres text[] of open-ended relationship tags (no closed union).
// table_number / seat_number are nullable ints set during seating. is_primary is
// constrained to at most one true per party by a partial unique index and
// enforced transactionally by the service.
//
// placeholder_text marks an unnamed plus-one slot: a guest is a placeholder
// iff it is non-NULL, and its value is the slot's permanent descriptor (e.g.
// "Guest of John Doe"). Naming the slot during RSVP overwrites full_name but
// never the descriptor, so "has been named" is derived as full_name !=
// placeholder_text. Clearing the text (admin PATCH) turns the row back into a
// regular guest.
type Guest struct {
	bun.BaseModel `bun:"table:guests,alias:g" tstype:"-"`

	ID       string   `bun:"id,pk" json:"id"`
	PartyID  string   `bun:"party_id" json:"party_id"`
	FullName string   `bun:"full_name" json:"full_name"`
	Email    *string  `bun:"email" json:"email"`
	Phone    *string  `bun:"phone" json:"phone"`
	Tags     []string `bun:"tags,array" json:"tags"`

	IsPrimary  bool `bun:"is_primary" json:"is_primary"`
	IsChild    bool `bun:"is_child" json:"is_child"`
	IsDrinking bool `bun:"is_drinking" json:"is_drinking"`

	// Subscribed is the per-guest Email Subscription flag (ADR 0009): whether the
	// guest receives broadcast email updates. New guests are created subscribed;
	// unsubscribing (the email footer link, the info-form checkbox, or the admin
	// edit) flips it to false and resubscribing flips it back. The column
	// defaults true, but the creation paths set it explicitly because a Go bool's
	// zero value is false, which bun would otherwise write over the default.
	Subscribed bool `bun:"subscribed" json:"subscribed"`

	PlaceholderText     *string `bun:"placeholder_text" json:"placeholder_text"`
	DietaryRestrictions *string `bun:"dietary_restrictions" json:"dietary_restrictions"`
	TableNumber         *int    `bun:"table_number" json:"table_number"`
	SeatNumber          *int    `bun:"seat_number" json:"seat_number"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`

	// Party is populated only when explicitly loaded (e.g. the flat guest list
	// joins it for the party name). It is an ORM relation over the existing
	// party_id FK, not a stored column, so it needs no migration; bun fills it via
	// relation queries. It is omitted from JSON: responses surface the party name
	// through the GuestListItem response type, not a nested party.
	Party *Party `bun:"rel:belongs-to,join:party_id=id" json:"-" tstype:"-"`
}

// BeforeAppendModel normalizes a nil Tags to an empty (non-nil) slice before
// any insert or update so the NOT NULL tags text[] column always stores '{}'
// rather than NULL. Like Party.BeforeAppendModel, this is the single,
// code-path-independent enforcement point for the slice invariant (the binder's
// `default:"[]"` covers the HTTP path; this hook covers direct service calls).
func (g *Guest) BeforeAppendModel(_ context.Context, query bun.Query) error {
	switch query.(type) {
	case *bun.InsertQuery, *bun.UpdateQuery:
		if g.Tags == nil {
			g.Tags = []string{}
		}
	}
	return nil
}

// OrderGuestsWithinParty applies the canonical order for listing a party's
// guests to a Guests query, whether a relation eager-load hook
// (Relation("Guests", OrderGuestsWithinParty)) or a plain select. The primary
// comes first, then the rest of the adults, then the children, each group in
// creation order with the id as a stable tiebreak: is_primary DESC sorts the
// lone primary ahead of everyone, is_child ASC drops the children to the end.
// The RSVP form, the info-collection form, and every admin view that lists a
// party's guests share this one order, so a guest never lands in a different
// position between them. It lives here, beside the guests-table alias it
// references, because the three feature packages that need it (rsvps, info,
// parties) all import models but must not import each other. promoteOldestGuest
// is deliberately not built on it: it wants the single oldest guest, which is a
// different question than display order.
func OrderGuestsWithinParty(q *bun.SelectQuery) *bun.SelectQuery {
	return q.Order("g.is_primary DESC", "g.is_child ASC", "g.created_at ASC", "g.id ASC")
}
