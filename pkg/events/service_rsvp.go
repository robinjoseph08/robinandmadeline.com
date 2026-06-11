package events

import (
	"context"
	"database/sql"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// InviteParties invites parties to a private event by creating a pending Event
// RSVP row for every guest in those parties (ADR 0002: the row is the
// invitation). Guests already invited keep their row untouched, so re-inviting
// is idempotent and never resets a response. The whole invite is one
// transaction: a missing event is a 404, a public event or an unknown party id
// is a 422, and either failure leaves no rows behind. Returns the event so the
// handler can respond with refreshed RSVP counts.
func (s *Service) InviteParties(ctx context.Context, eventID string, in InvitePartiesPayload) (*models.Event, error) {
	event := new(models.Event)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		loaded, err := loadEvent(ctx, tx, eventID)
		if err != nil {
			return err
		}
		*event = *loaded

		// A public event already invites everyone; an explicit invite would only
		// mask a modeling mistake (e.g. the admin meant a private event).
		if event.IsPublic {
			return errcodes.ValidationError("This event is public; every guest is already invited.")
		}

		// Every supplied party must exist: counting matches against the distinct
		// ids catches both unknown ids and (harmless) duplicates in one query,
		// and refusing the whole invite keeps it all-or-nothing.
		partyIDs := dedupe(in.PartyIDs)
		found, err := tx.NewSelect().Model((*models.Party)(nil)).
			Where("id IN (?)", bun.List(partyIDs)).Count(ctx)
		if err != nil {
			return errors.Wrap(err, "count invited parties")
		}
		if found != len(partyIDs) {
			return errcodes.ValidationError("One or more of those parties do not exist.")
		}

		var guestIDs []string
		err = tx.NewSelect().Model((*models.Guest)(nil)).Column("id").
			Where("party_id IN (?)", bun.List(partyIDs)).Scan(ctx, &guestIDs)
		if err != nil {
			return errors.Wrap(err, "list invited parties' guests")
		}
		return insertPendingRSVPs(ctx, tx, []string{eventID}, guestIDs)
	})
	if err != nil {
		return nil, err
	}
	return event, nil
}

// ListEventRSVPs returns every Event RSVP row for an event (in guest creation
// order, so the list never reshuffles) and the total count, each with its
// Guest and the guest's Party loaded for the response's name/party context. A
// missing event is a 404 (an empty list means "nobody invited", which must be
// distinguishable from "no such event").
func (s *Service) ListEventRSVPs(ctx context.Context, eventID string) ([]*models.EventRSVP, int, error) {
	if _, err := loadEvent(ctx, s.db, eventID); err != nil {
		return nil, 0, err
	}

	var rows []*models.EventRSVP
	total, err := s.db.NewSelect().Model(&rows).
		Relation("Guest").Relation("Guest.Party").
		Where("er.event_id = ?", eventID).
		Order("guest.created_at ASC", "guest.id ASC").
		ScanAndCount(ctx)
	if err != nil {
		return nil, 0, errors.Wrap(err, "list event rsvps")
	}
	return rows, total, nil
}

// UpdateRSVPStatus is the admin override for one guest's response to one event
// (a phone or in-person answer). It sets the row's status and stamps rsvped_at
// for a response (attending / not_attending) or clears it when the row is
// reset to pending, touching exactly that one row. A guest with no row for the
// event is a 404: there is no invitation to override (ADR 0002). The updated
// row comes back with its Guest and Party loaded, like a ListEventRSVPs item.
func (s *Service) UpdateRSVPStatus(ctx context.Context, eventID, guestID string, in UpdateEventRSVPPayload) (*models.EventRSVP, error) {
	row := new(models.EventRSVP)
	err := s.db.NewSelect().Model(row).
		Relation("Guest").Relation("Guest.Party").
		Where("er.event_id = ?", eventID).Where("er.guest_id = ?", guestID).
		Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("RSVP")
		}
		return nil, errors.Wrap(err, "load event rsvp")
	}

	now := time.Now()
	row.Status = in.Status
	if in.Status == models.RSVPPending {
		row.RSVPedAt = nil
	} else {
		row.RSVPedAt = pointerutil.Time(now)
	}
	row.UpdatedAt = now

	_, err = s.db.NewUpdate().Model(row).
		Column("status", "rsvped_at", "updated_at").
		WherePK().Exec(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "update event rsvp")
	}
	return row, nil
}

// RSVPBreakdowns tallies the Event RSVP rows by status for the given events in
// one grouped query, returning a map keyed by event id. An event with no rows
// maps to the zero breakdown (and a zero Total, which doubles as "nobody
// invited"). With no event ids it returns an empty map.
func (s *Service) RSVPBreakdowns(ctx context.Context, eventIDs []string) (map[string]RSVPBreakdown, error) {
	breakdowns := make(map[string]RSVPBreakdown, len(eventIDs))
	if len(eventIDs) == 0 {
		return breakdowns, nil
	}

	var tallies []struct {
		EventID string `bun:"event_id"`
		Status  string `bun:"status"`
		Count   int    `bun:"count"`
	}
	err := s.db.NewSelect().Model((*models.EventRSVP)(nil)).
		Column("event_id", "status").ColumnExpr("count(*) AS count").
		Where("event_id IN (?)", bun.List(eventIDs)).
		Group("event_id", "status").
		Scan(ctx, &tallies)
	if err != nil {
		return nil, errors.Wrap(err, "tally event rsvps")
	}

	for _, t := range tallies {
		b := breakdowns[t.EventID]
		switch t.Status {
		case models.RSVPPending:
			b.Pending = t.Count
		case models.RSVPAttending:
			b.Attending = t.Count
		case models.RSVPNotAttending:
			b.NotAttending = t.Count
		}
		b.Total += t.Count
		breakdowns[t.EventID] = b
	}
	return breakdowns, nil
}

// dedupe returns the distinct values of ids, preserving first-seen order, so
// a duplicated party id in an invite payload neither double-counts in the
// existence check nor double-inserts.
func dedupe(ids []string) []string {
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
