package emails

import (
	"context"
	"slices"
	"strings"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
)

// RecipientResolution partitions the guests matching a send's filter into the
// ones the send will reach and the two reasons a match is excluded: no email
// address on file, or unsubscribed from email updates (ADR 0009). All three
// slices are non-nil so callers can range and count them without a guard.
type RecipientResolution struct {
	Recipients          []*models.Guest
	SkippedNoEmail      []*models.Guest
	SkippedUnsubscribed []*models.Guest
}

// ResolveRecipients returns how a send with the given filter partitions the
// matching guests (each with its Party loaded, ordered by creation time): the
// recipients it will reach, and the two excluded buckets. A guest without an
// email cannot be sent to, and an unsubscribed guest must not be (ADR 0009);
// surfacing both excluded sets lets the compose page show exactly who the send
// cannot reach, and why, instead of hiding the gap.
//
// The filter semantics mirror the flat guest list (pkg/parties.ListGuests),
// with every criterion a list whose values are OR'd: guest_ids picks guests
// directly, sides/relations/circles/invitation_types constrain through the
// guest's party, tags matches guests whose tags array overlaps the selected
// tags, and event_ids / rsvp_statuses constrain through the guest's Event RSVP
// rows (a row is the invitation, ADR 0002), both applying to the same row.
// info_collection_statuses filters on the party's derived status, which cannot
// be expressed in SQL (ADR 0005), so like parties.ListParties it is applied in
// Go over the candidates.
func (s *Service) ResolveRecipients(ctx context.Context, f models.RecipientFilter) (*RecipientResolution, error) {
	var guests []*models.Guest
	q := s.db.NewSelect().Model(&guests).Relation("Party").Order("g.created_at ASC", "g.id ASC")

	if len(f.GuestIDs) > 0 {
		q = q.Where("g.id IN (?)", bun.List(f.GuestIDs))
	}
	// Party-level attributes constrain the owning party via one correlated
	// EXISTS subquery carrying all party predicates.
	if len(f.Sides) > 0 || len(f.Relations) > 0 || len(f.Circles) > 0 || len(f.InvitationTypes) > 0 {
		q = q.Where("EXISTS (?)", recipientPartySubquery(s.db, f))
	}
	if len(f.Tags) > 0 {
		// Array overlap: the guest's tags include ANY of the selected tags.
		q = q.Where("g.tags && ?", pgdialect.Array(f.Tags))
	}
	if len(f.EventIDs) > 0 || len(f.RSVPStatuses) > 0 {
		sub := s.db.NewSelect().Model((*models.EventRSVP)(nil)).Column("id").
			Where("er.guest_id = g.id")
		if len(f.EventIDs) > 0 {
			sub = sub.Where("er.event_id IN (?)", bun.List(f.EventIDs))
		}
		if len(f.RSVPStatuses) > 0 {
			sub = sub.Where("er.status IN (?)", bun.List(f.RSVPStatuses))
		}
		q = q.Where("EXISTS (?)", sub)
	}

	if err := q.Scan(ctx); err != nil {
		return nil, errors.Wrap(err, "resolve email recipients")
	}

	if len(f.InfoCollectionStatuses) > 0 {
		filtered, err := s.filterByInfoCollectionStatus(ctx, guests, f.InfoCollectionStatuses)
		if err != nil {
			return nil, err
		}
		guests = filtered
	}

	// Partition the matches: a guest with no email cannot be reached, an
	// unsubscribed guest must not be (ADR 0009), and the rest are recipients.
	// The no-email check comes first so a guest who is both unsubscribed and has
	// no email is reported under the more fundamental reason.
	res := &RecipientResolution{
		Recipients:          make([]*models.Guest, 0, len(guests)),
		SkippedNoEmail:      make([]*models.Guest, 0),
		SkippedUnsubscribed: make([]*models.Guest, 0),
	}
	for _, g := range guests {
		switch {
		case g.Email == nil || strings.TrimSpace(*g.Email) == "":
			res.SkippedNoEmail = append(res.SkippedNoEmail, g)
		case !g.Subscribed:
			res.SkippedUnsubscribed = append(res.SkippedUnsubscribed, g)
		default:
			res.Recipients = append(res.Recipients, g)
		}
	}
	return res, nil
}

// recipientPartySubquery builds the correlated subquery ResolveRecipients uses
// to filter on the guest's party attributes.
func recipientPartySubquery(db *bun.DB, f models.RecipientFilter) *bun.SelectQuery {
	sub := db.NewSelect().Model((*models.Party)(nil)).Column("id").Where("p.id = g.party_id")
	if len(f.Sides) > 0 {
		sub = sub.Where("p.side IN (?)", bun.List(f.Sides))
	}
	if len(f.Relations) > 0 {
		sub = sub.Where("p.relation IN (?)", bun.List(f.Relations))
	}
	if len(f.Circles) > 0 {
		// Array overlap: the party is in ANY of the selected circles.
		sub = sub.Where("p.circle && ?", pgdialect.Array(f.Circles))
	}
	if len(f.InvitationTypes) > 0 {
		sub = sub.Where("p.invitation_type IN (?)", bun.List(f.InvitationTypes))
	}
	return sub
}

// filterByInfoCollectionStatus keeps the guests whose party's derived
// info-collection status is one of statuses. Status is a party-level property
// now (the invitation type, the mailing address, and the two collection flags,
// with no guest field at all since email became optional for completion), so
// the distinct parties are reloaded and evaluated via the same model method the
// parties API uses, keeping the filter and the displayed status in agreement.
func (s *Service) filterByInfoCollectionStatus(ctx context.Context, guests []*models.Guest, statuses []string) ([]*models.Guest, error) {
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
	err := s.db.NewSelect().Model(&parties).
		Where("p.id IN (?)", bun.List(partyIDs)).Scan(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "load parties for info status filter")
	}
	matches := make(map[string]bool, len(parties))
	for _, p := range parties {
		matches[p.ID] = slices.Contains(statuses, p.InfoCollectionStatus())
	}

	filtered := guests[:0]
	for _, g := range guests {
		if matches[g.PartyID] {
			filtered = append(filtered, g)
		}
	}
	return filtered, nil
}
