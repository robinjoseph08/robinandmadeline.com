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
// email and phone are per-guest (the mailing address lives on the party). roles
// is a Postgres text[] of open-ended relationship tags (no closed union).
// table_number / seat_number are nullable ints set during seating. is_primary is
// constrained to at most one true per party by a partial unique index and
// enforced transactionally by the service.
type Guest struct {
	bun.BaseModel `bun:"table:guests,alias:g" tstype:"-"`

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

	// Party is populated only when explicitly loaded (e.g. the flat guest list
	// joins it for the party name). It is an ORM relation over the existing
	// party_id FK, not a stored column, so it needs no migration; bun fills it via
	// relation queries. It is omitted from JSON: responses surface the party name
	// through the GuestListItem response type, not a nested party.
	Party *Party `bun:"rel:belongs-to,join:party_id=id" json:"-" tstype:"-"`
}

// BeforeAppendModel normalizes a nil Roles to an empty (non-nil) slice before
// any insert or update so the NOT NULL roles text[] column always stores '{}'
// rather than NULL. Like Party.BeforeAppendModel, this is the single,
// code-path-independent enforcement point for the slice invariant (the binder's
// `default:"[]"` covers the HTTP path; this hook covers direct service calls).
func (g *Guest) BeforeAppendModel(_ context.Context, query bun.Query) error {
	switch query.(type) {
	case *bun.InsertQuery, *bun.UpdateQuery:
		if g.Roles == nil {
			g.Roles = []string{}
		}
	}
	return nil
}
