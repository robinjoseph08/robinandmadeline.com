package emails

import (
	"context"
	"strings"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// ResolveRecipients returns the guests a send with the given filter goes to
// (each with its Party loaded, ordered by creation time) plus the guests that
// matched the filter but were skipped for having no email address. A guest
// without an email cannot receive an email, so it is never a recipient; the
// skipped list lets the compose page surface exactly who the send cannot reach
// instead of hiding the gap. Both slices are non-nil so callers can range them
// and report a count without a length guard.
//
// The filter semantics mirror the flat guest list (pkg/parties.ListGuests):
// side/relation/circle/invitation_type constrain through the guest's party,
// tags matches guests whose tags array overlaps the selected tags (ANY of),
// and event_id / rsvp_status constrain through the guest's Event RSVP rows (a
// row is the invitation, ADR 0002). info_collection_status filters on the
// party's derived status, which cannot be expressed in SQL (ADR 0005), so like
// parties.ListParties it is applied in Go over the candidates.
func (s *Service) ResolveRecipients(ctx context.Context, f models.RecipientFilter) (recipients, skipped []*models.Guest, err error) {
	var guests []*models.Guest
	q := s.db.NewSelect().Model(&guests).Relation("Party").Order("g.created_at ASC", "g.id ASC")

	// Party-level attributes constrain the owning party via one correlated
	// EXISTS subquery carrying all party predicates.
	if f.Side != nil || f.Relation != nil || f.Circle != nil || f.InvitationType != nil {
		q = q.Where("EXISTS (?)", recipientPartySubquery(s.db, f))
	}
	if len(f.Tags) > 0 {
		// Array overlap: the guest's tags include ANY of the selected tags.
		q = q.Where("g.tags && ?", pgdialect.Array(f.Tags))
	}
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

	if err := q.Scan(ctx); err != nil {
		return nil, nil, errors.Wrap(err, "resolve email recipients")
	}

	if f.InfoCollectionStatus != nil {
		filtered, err := s.filterByInfoCollectionStatus(ctx, guests, *f.InfoCollectionStatus)
		if err != nil {
			return nil, nil, err
		}
		guests = filtered
	}

	// Partition on email presence: guests with one are recipients, the rest
	// are collected so the admin sees who the send cannot reach.
	recipients = make([]*models.Guest, 0, len(guests))
	skipped = make([]*models.Guest, 0)
	for _, g := range guests {
		if g.Email != nil && strings.TrimSpace(*g.Email) != "" {
			recipients = append(recipients, g)
		} else {
			skipped = append(skipped, g)
		}
	}
	return recipients, skipped, nil
}

// recipientPartySubquery builds the correlated subquery ResolveRecipients uses
// to filter on the guest's party attributes.
func recipientPartySubquery(db *bun.DB, f models.RecipientFilter) *bun.SelectQuery {
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
	if f.InvitationType != nil {
		sub = sub.Where("p.invitation_type = ?", *f.InvitationType)
	}
	return sub
}

// filterByInfoCollectionStatus keeps the guests whose party's derived
// info-collection status matches. The status needs each party's full guest
// list (the primary guest's email is part of the completion gate), so the
// distinct parties are reloaded with their Guests relation and evaluated via
// the same model method the parties API uses, keeping the filter and the
// displayed status in agreement.
func (s *Service) filterByInfoCollectionStatus(ctx context.Context, guests []*models.Guest, status string) ([]*models.Guest, error) {
	if len(guests) == 0 {
		return guests, nil
	}

	partyIDs := make([]string, 0, len(guests))
	seen := make(map[string]struct{}, len(guests))
	for _, g := range guests {
		if _, ok := seen[g.PartyID]; ok {
			continue
		}
		seen[g.PartyID] = struct{}{}
		partyIDs = append(partyIDs, g.PartyID)
	}

	var parties []*models.Party
	err := s.db.NewSelect().Model(&parties).Relation("Guests").
		Where("p.id IN (?)", bun.List(partyIDs)).Scan(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "load parties for info status filter")
	}
	matches := make(map[string]bool, len(parties))
	for _, p := range parties {
		matches[p.ID] = p.InfoCollectionStatus() == status
	}

	filtered := guests[:0]
	for _, g := range guests {
		if matches[g.PartyID] {
			filtered = append(filtered, g)
		}
	}
	return filtered, nil
}
