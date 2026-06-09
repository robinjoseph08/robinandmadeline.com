package parties

import (
	"context"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// ListParties returns parties matching the filter (each with guests loaded,
// ordered by creation time) and the total count.
//
// Every filter except InfoCollectionStatus is applied in SQL. Status cannot be
// expressed cleanly in SQL because it depends on the derived rules over the
// primary guest's email plus invitation_type and the two flags, so it is
// computed in Go via the model and filtered here; the total then reflects the
// filtered set. At wedding scale (hundreds of parties) loading the candidate set
// and filtering one predicate in Go is comfortably fine.
func (s *Service) ListParties(ctx context.Context, f ListPartiesQuery) ([]*models.Party, int, error) {
	var parties []*models.Party
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

	// With no status filter the SQL count is the total. With one, we filter the
	// derived status in Go and recount, so the extra COUNT is only worth running
	// in the no-status-filter branch.
	if f.InfoCollectionStatus == nil {
		total, err := q.ScanAndCount(ctx)
		if err != nil {
			return nil, 0, errors.Wrap(err, "list parties")
		}
		return parties, total, nil
	}

	if err := q.Scan(ctx); err != nil {
		return nil, 0, errors.Wrap(err, "list parties")
	}

	// Filter status in Go via the same model method the responses use, so the
	// filter and the displayed status can never disagree; the total is the
	// filtered count.
	filtered := parties[:0]
	for _, p := range parties {
		if p.InfoCollectionStatus() == *f.InfoCollectionStatus {
			filtered = append(filtered, p)
		}
	}
	return filtered, len(filtered), nil
}

// ListGuests returns guests matching the flat filter (ordered by creation time)
// and the total count. Each guest's owning party is eager-loaded so the flat
// list can show the party name (a guest has no detail page of its own; it is
// edited in the context of its party). Party-level filters (side/relation/
// circle) are applied via a correlated EXISTS against the guest's party, keeping
// the result a flat guest list.
func (s *Service) ListGuests(ctx context.Context, f ListGuestsQuery) ([]*models.Guest, int, error) {
	var guests []*models.Guest
	q := s.db.NewSelect().Model(&guests).Relation("Party").Order("g.created_at ASC")

	if f.PartyID != nil {
		q = q.Where("g.party_id = ?", *f.PartyID)
	}
	if f.IsDrinking != nil {
		q = q.Where("g.is_drinking = ?", *f.IsDrinking)
	}
	if f.IsChild != nil {
		q = q.Where("g.is_child = ?", *f.IsChild)
	}
	if f.IsPlaceholder != nil {
		q = q.Where("g.is_placeholder = ?", *f.IsPlaceholder)
	}
	if f.Tags != nil {
		q = q.Where("? = ANY(g.tags)", *f.Tags)
	}

	// Party-level attributes filter the guest list by constraining the owning
	// party. A single correlated EXISTS subquery carries all party predicates.
	if f.Side != nil || f.Relation != nil || f.Circle != nil {
		q = q.Where("EXISTS (?)", partyScopeSubquery(s.db, f))
	}

	total, err := q.ScanAndCount(ctx)
	if err != nil {
		return nil, 0, errors.Wrap(err, "list guests")
	}
	return guests, total, nil
}

// partyScopeSubquery builds the correlated subquery ListGuests uses to filter on
// the guest's party attributes: select 1 from parties where the party is the
// guest's party and matches the supplied party-level predicates.
func partyScopeSubquery(db *bun.DB, f ListGuestsQuery) *bun.SelectQuery {
	sub := db.NewSelect().Model((*models.Party)(nil)).Column("id").Where("p.id = g.party_id")
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
