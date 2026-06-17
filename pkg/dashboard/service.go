// Package dashboard is the admin overview: a single read-only GET that
// aggregates stats across parties, guests, events, Event RSVPs, info-collection
// status, and emails into one response for the admin home. It computes
// everything fresh on each request (no caching) so the numbers never go stale.
// It owns no tables of its own; it reads through the feature services where one
// already exposes what it needs (events' RSVP breakdowns, the settings reader)
// and drops to aggregate SQL only where no reusable accessor exists. The
// persistent models live in pkg/models.
package dashboard

import (
	"context"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/settings"
	"github.com/uptrace/bun"
)

// Service assembles the dashboard overview over a Bun DB. Construct it with
// NewService. It composes the events and settings services so the per-event
// RSVP breakdown and the RSVP-deadline read reuse exactly the logic those
// packages already own. Methods return errcodes/wrapped errors directly;
// handlers pass them through to the shared error handler.
type Service struct {
	db       *bun.DB
	events   *events.Service
	settings *settings.Service
}

// NewService builds a Service backed by the given Bun DB, constructing the
// events and settings services it composes from the same DB.
func NewService(db *bun.DB) *Service {
	return &Service{
		db:       db,
		events:   events.NewService(db),
		settings: settings.NewService(db),
	}
}

// Overview computes the full dashboard response. Each piece is an independent
// read against the current data, so the result always reflects the latest
// state (the issue's "not cached stale" requirement). Any read error is
// wrapped and returned; the handler renders it.
func (s *Service) Overview(ctx context.Context) (*Response, error) {
	resp := new(Response)

	totalParties, err := s.db.NewSelect().Model((*models.Party)(nil)).Count(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "count parties")
	}
	resp.TotalParties = totalParties

	totalGuests, err := s.db.NewSelect().Model((*models.Guest)(nil)).Count(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "count guests")
	}
	resp.TotalGuests = totalGuests

	breakdown, err := s.guestBreakdown(ctx)
	if err != nil {
		return nil, err
	}
	resp.GuestBreakdown = breakdown

	eventStats, summary, err := s.eventRSVPStats(ctx)
	if err != nil {
		return nil, err
	}
	resp.Events = eventStats
	resp.RSVPSummary = summary

	progress, err := s.infoProgress(ctx)
	if err != nil {
		return nil, err
	}
	resp.InfoCollection = progress

	emailStats, err := s.emailStats(ctx)
	if err != nil {
		return nil, err
	}
	resp.Emails = emailStats

	cfg, err := s.settings.Get(ctx)
	if err != nil {
		return nil, err
	}
	resp.RSVPDeadline = cfg.RSVPDeadline

	return resp, nil
}

// guestBreakdown tallies guests by their party's side and relation in two
// grouped queries (a guest joins to its party). Each closed-enum value maps to
// its explicit field; a value with no guests stays zero. An unexpected value
// (would only arise if the CHECK constraint were bypassed) is ignored rather
// than crashing the dashboard.
func (s *Service) guestBreakdown(ctx context.Context) (GuestBreakdown, error) {
	var breakdown GuestBreakdown

	bySide, err := s.countGuestsByPartyColumn(ctx, "p.side")
	if err != nil {
		return GuestBreakdown{}, errors.Wrap(err, "count guests by side")
	}
	breakdown.BySide.Robin = bySide[models.SideRobin]
	breakdown.BySide.Madeline = bySide[models.SideMadeline]

	byRelation, err := s.countGuestsByPartyColumn(ctx, "p.relation")
	if err != nil {
		return GuestBreakdown{}, errors.Wrap(err, "count guests by relation")
	}
	breakdown.ByRelation.Family = byRelation[models.RelationFamily]
	breakdown.ByRelation.Friend = byRelation[models.RelationFriend]

	return breakdown, nil
}

// countGuestsByPartyColumn counts guests grouped by a column on their owning
// party, returning a value->count map. The column is a fixed, internal
// identifier (never user input), so interpolating it into the query is safe.
func (s *Service) countGuestsByPartyColumn(ctx context.Context, column string) (map[string]int, error) {
	var rows []struct {
		Key   string `bun:"key"`
		Count int    `bun:"count"`
	}
	err := s.db.NewSelect().Model((*models.Guest)(nil)).
		Join("JOIN parties AS p ON p.id = g.party_id").
		ColumnExpr(column+" AS key").
		ColumnExpr("count(*) AS count").
		Group(column).
		Scan(ctx, &rows)
	if err != nil {
		return nil, err
	}
	out := make(map[string]int, len(rows))
	for _, r := range rows {
		out[r.Key] = r.Count
	}
	return out, nil
}

// eventRSVPStats lists every event in schedule order with its RSVP breakdown
// (reusing the events service's breakdown query so the per-event shape matches
// the events list exactly) and rolls the breakdowns up into the site-wide
// summary. With no events the slice is empty (never nil) and the summary is all
// zeros with a 0 response rate.
func (s *Service) eventRSVPStats(ctx context.Context) ([]EventRSVPStats, RSVPSummary, error) {
	list, _, err := s.events.ListEvents(ctx)
	if err != nil {
		return nil, RSVPSummary{}, err
	}

	ids := make([]string, 0, len(list))
	for _, e := range list {
		ids = append(ids, e.ID)
	}
	breakdowns, err := s.events.RSVPBreakdowns(ctx, ids)
	if err != nil {
		return nil, RSVPSummary{}, err
	}

	stats := make([]EventRSVPStats, 0, len(list))
	var summary RSVPSummary
	for _, e := range list {
		b := breakdowns[e.ID]
		stats = append(stats, EventRSVPStats{Event: *e, RSVPBreakdown: b})
		summary.Attending += b.Attending
		summary.NotAttending += b.NotAttending
		summary.Pending += b.Pending
		summary.Total += b.Total
	}
	summary.Responded = summary.Attending + summary.NotAttending
	summary.ResponseRate = ratio(summary.Responded, summary.Total)

	return stats, summary, nil
}

// infoProgress tallies parties by their effective info-collection status (ADR
// 0005). Status is derived in Go via the model method (it depends on the
// primary guest's email, the invitation type, and the two flags), exactly as
// pkg/parties does, so the dashboard count and the parties list can never
// disagree. The parties are loaded with their guests because the status method
// reads the primary guest.
func (s *Service) infoProgress(ctx context.Context) (InfoCollectionProgress, error) {
	var parties []*models.Party
	err := s.db.NewSelect().Model(&parties).Relation("Guests").Scan(ctx)
	if err != nil {
		return InfoCollectionProgress{}, errors.Wrap(err, "list parties for info progress")
	}

	var progress InfoCollectionProgress
	for _, p := range parties {
		if p.InfoCollectionStatus() == models.StatusComplete {
			progress.Complete++
		} else {
			progress.Incomplete++
		}
	}
	progress.Total = len(parties)
	progress.Rate = ratio(progress.Complete, progress.Total)
	return progress, nil
}

// emailStats rolls the guest-facing email_recipients rows up into the delivery
// summary. A recipient counts as Sent once it has been dispatched to Mailgun
// (status sent, delivered, or bounced; delivered/bounced are sent rows the
// webhook upgraded), and Delivered when Mailgun confirmed delivery.
// queued/sending rows are not yet sent and a failed row never reached Mailgun,
// so neither counts. The delivery rate is Delivered/Sent, 0 when nothing has
// been sent.
//
// Test sends (is_test on the parent send, addressed to the couple's own
// inboxes rather than guests) are excluded, so this headline reflects guest
// delivery only and a "Send test" never inflates it.
func (s *Service) emailStats(ctx context.Context) (EmailStats, error) {
	var rows []struct {
		Status string `bun:"status"`
		Count  int    `bun:"count"`
	}
	err := s.db.NewSelect().Model((*models.EmailRecipient)(nil)).
		Join("JOIN email_sends AS es ON es.id = erc.send_id").
		Where("es.is_test = FALSE").
		ColumnExpr("erc.status AS status").
		ColumnExpr("count(*) AS count").
		Group("erc.status").
		Scan(ctx, &rows)
	if err != nil {
		return EmailStats{}, errors.Wrap(err, "tally email recipients")
	}

	var stats EmailStats
	for _, r := range rows {
		switch r.Status {
		case models.EmailDelivered:
			stats.Delivered += r.Count
			stats.Sent += r.Count
		case models.EmailSent, models.EmailBounced:
			stats.Sent += r.Count
		}
	}
	stats.DeliveryRate = ratio(stats.Delivered, stats.Sent)
	return stats, nil
}

// ratio returns numerator/denominator as a float, or 0 when the denominator is
// zero, so every rate stat handles an empty data set without a divide-by-zero.
func ratio(numerator, denominator int) float64 {
	if denominator == 0 {
		return 0
	}
	return float64(numerator) / float64(denominator)
}
