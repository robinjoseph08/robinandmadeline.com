package parties

import (
	"context"
	"regexp"
	"strings"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// nonDigitRE strips formatting from a phone search term so it can match stored
// E.164 numbers, which are digits only.
var nonDigitRE = regexp.MustCompile(`\D`)

// likeEscaper escapes the characters LIKE/ILIKE treat specially, backslash
// first so the added escapes are not themselves escaped.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// escapeLike makes a user-supplied search term safe to embed in an ILIKE
// pattern: without it "_" matches any character, "%" matches everything, and a
// trailing "\" breaks the pattern outright.
func escapeLike(term string) string {
	return likeEscaper.Replace(term)
}

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
	q := s.db.NewSelect().Model(&parties).Relation("Guests", orderGuestsByCreation).Order("p.created_at ASC", "p.id ASC")

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
	q := s.db.NewSelect().Model(&guests).Relation("Party").Order("g.created_at ASC", "g.id ASC")

	if f.PartyID != nil {
		q = q.Where("g.party_id = ?", *f.PartyID)
	}
	if f.Search != nil && *f.Search != "" {
		// A single search box across the guest's own fields and the owning party's
		// name, case-insensitive substring. The term is escaped so a literal "_" or
		// "%" in it matches itself rather than acting as a wildcard. The party name
		// match is a correlated EXISTS so it stays a flat guest query.
		pattern := "%" + escapeLike(*f.Search) + "%"
		partyNameMatch := s.db.NewSelect().Model((*models.Party)(nil)).Column("id").
			Where("p.id = g.party_id").Where("p.name ILIKE ?", pattern)
		clause := "g.full_name ILIKE ? OR g.email ILIKE ? OR EXISTS (?)"
		args := []any{pattern, pattern, partyNameMatch}
		// Phones are stored as canonical E.164 (digits, no formatting), so match the
		// query with its formatting stripped too, letting "(415) 555-2671" find
		// "+14155552671". Only when the query has digits, so a text-only search does
		// not match every guest who happens to have a phone.
		if digits := nonDigitRE.ReplaceAllString(*f.Search, ""); digits != "" {
			clause += " OR regexp_replace(g.phone, '\\D', '', 'g') ILIKE ?"
			args = append(args, "%"+digits+"%")
		}
		q = q.Where("("+clause+")", args...)
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

	// Event / RSVP-status filters constrain through the guest's Event RSVP
	// rows with one correlated EXISTS (a row is the invitation, ADR 0002): an
	// event alone matches its invited set, event+status constrains within that
	// event, and status alone matches a row in that status on any event.
	if f.EventID != nil || f.RSVPStatus != nil {
		sub := s.db.NewSelect().Model((*models.EventRSVP)(nil)).Column("id").
			Where("er.guest_id = g.id")
		if f.EventID != nil {
			sub = sub.Where("er.event_id = ?", *f.EventID)
		}
		if f.RSVPStatus != nil {
			sub = sub.Where("er.status = ?", *f.RSVPStatus)
		}
		q = q.Where("EXISTS (?)", sub)
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
