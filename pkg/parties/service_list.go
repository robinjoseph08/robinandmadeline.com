package parties

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// PartyFilter is the set of party list filters. A nil pointer (or empty slice)
// means "do not filter on this field". Most filters translate to SQL WHERE
// clauses; InfoCollectionStatus is the exception (see ListParties).
type PartyFilter struct {
	Side                    *string
	Relation                *string
	Circle                  *string // matches parties whose circle array contains this value
	InvitationType          *string
	InfoCollectionRequested *bool
	InfoCollectionStatus    *string // "complete" / "incomplete"; filtered in Go
}

// GuestFilter is the set of flat guest-list filters. Side / Relation / Circle
// are party-level attributes, so those clauses join through the guest's party.
// Event- and RSVP-status filters are intentionally absent: they depend on the
// event model (#6) which does not exist yet.
type GuestFilter struct {
	Side          *string
	Relation      *string
	Circle        *string
	Roles         *string // matches guests whose roles array contains this value
	IsDrinking    *bool
	IsChild       *bool
	IsPlaceholder *bool
}

// ListParties returns parties matching the filter, each with its guests loaded
// and ordered by creation time.
//
// Every filter except InfoCollectionStatus is applied in SQL. Status cannot be
// expressed cleanly in SQL because it depends on the derived rules over the
// joined primary guest's email plus invitation_type and the two flags, so it is
// computed in Go via StatusOf and filtered here. At wedding scale (hundreds of
// parties) loading the candidate set and filtering one predicate in Go is
// comfortably fine.
func (s *Service) ListParties(ctx context.Context, f PartyFilter) ([]*Party, error) {
	var parties []*Party
	q := s.db.NewSelect().Model(&parties).Relation("Guests").Order("p.created_at ASC")

	if f.Side != nil {
		q = q.Where("p.side = ?", *f.Side)
	}
	if f.Relation != nil {
		q = q.Where("p.relation = ?", *f.Relation)
	}
	if f.InvitationType != nil {
		q = q.Where("p.invitation_type = ?", *f.InvitationType)
	}
	if f.InfoCollectionRequested != nil {
		q = q.Where("p.info_collection_requested = ?", *f.InfoCollectionRequested)
	}
	if f.Circle != nil {
		// text[] containment: the circle array includes the requested value.
		q = q.Where("? = ANY(p.circle)", *f.Circle)
	}

	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("list parties: %w", err)
	}

	if f.InfoCollectionStatus == nil {
		return parties, nil
	}

	// Filter the one SQL-unfriendly predicate (status) in Go, reusing the same
	// pure rules the API responses use so the filter and the displayed status
	// can never disagree.
	filtered := parties[:0]
	for _, p := range parties {
		if StatusOf(p) == *f.InfoCollectionStatus {
			filtered = append(filtered, p)
		}
	}
	return filtered, nil
}

// ListGuests returns guests matching the flat filter, ordered by creation time.
// Party-level filters (side/relation/circle) are applied via a correlated
// EXISTS against the guest's party, keeping the result a flat guest list.
func (s *Service) ListGuests(ctx context.Context, f GuestFilter) ([]*Guest, error) {
	var guests []*Guest
	q := s.db.NewSelect().Model(&guests).Order("g.created_at ASC")

	if f.IsDrinking != nil {
		q = q.Where("g.is_drinking = ?", *f.IsDrinking)
	}
	if f.IsChild != nil {
		q = q.Where("g.is_child = ?", *f.IsChild)
	}
	if f.IsPlaceholder != nil {
		q = q.Where("g.is_placeholder = ?", *f.IsPlaceholder)
	}
	if f.Roles != nil {
		q = q.Where("? = ANY(g.roles)", *f.Roles)
	}

	// Party-level attributes filter the guest list by constraining the owning
	// party. A single correlated EXISTS subquery carries all party predicates.
	if f.Side != nil || f.Relation != nil || f.Circle != nil {
		q = q.Where("EXISTS (?)", partyScopeSubquery(s.db, f))
	}

	if err := q.Scan(ctx); err != nil {
		return nil, fmt.Errorf("list guests: %w", err)
	}
	return guests, nil
}

// partyScopeSubquery builds the correlated subquery used by ListGuests to filter
// on the guest's party attributes. It selects 1 from parties where the party is
// the guest's party and matches the supplied party-level predicates.
func partyScopeSubquery(db *bun.DB, f GuestFilter) *bun.SelectQuery {
	sub := db.NewSelect().Model((*Party)(nil)).Column("id").Where("p.id = g.party_id")
	if f.Side != nil {
		sub = sub.Where("p.side = ?", *f.Side)
	}
	if f.Relation != nil {
		sub = sub.Where("p.relation = ?", *f.Relation)
	}
	if f.Circle != nil {
		sub = sub.Where("? = ANY(p.circle)", *f.Circle)
	}
	return sub
}
