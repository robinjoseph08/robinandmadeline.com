// Package rsvps is the guest-facing RSVP flow: the API a logged-in party uses
// to read and submit its Event RSVPs. Reads return the party's guests and
// rows grouped by event; writes bulk-update statuses, fill in placeholder
// guest names, and store dietary restrictions, all gated by the rsvp_deadline
// app setting (a past deadline closes the window and rejects writes with a
// 403). The admin-facing event/RSVP management lives in pkg/events; the
// persistent models live in pkg/models.
package rsvps

import (
	"context"
	"database/sql"
	"sort"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// Service is the guest RSVP data layer over a Bun DB. Construct it with
// NewService. Methods take the authenticated party id (extracted from the
// guest JWT by the auth middleware) and never reach beyond that party's rows.
// Methods return errcodes errors directly; handlers pass them through to the
// shared error handler.
type Service struct {
	db *bun.DB
}

// NewService builds a Service backed by the given Bun DB.
func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

// settings is the slice of app_settings the RSVP flow reads.
type settings struct {
	// deadline is the parsed rsvp_deadline; nil means no deadline is set and
	// RSVPs stay open.
	deadline *time.Time
	// contactEmail is the configured contact_email; nil when unset.
	contactEmail *string
}

// closed reports whether the RSVP window is closed at the given moment. The
// deadline itself is still open ("by the deadline" inclusive); only moments
// after it are closed.
func (s settings) closed(now time.Time) bool {
	return s.deadline != nil && now.After(*s.deadline)
}

// loadSettings reads the RSVP-related app settings. A missing row is a valid
// state (no deadline, no contact email). An unparseable rsvp_deadline is an
// error rather than silently failing open or closed: it only arises from a
// bad manual write, and surfacing it loudly is what gets it fixed.
func loadSettings(ctx context.Context, db bun.IDB) (settings, error) {
	var rows []*models.AppSetting
	err := db.NewSelect().Model(&rows).
		Where("key IN (?)", bun.List([]string{models.AppSettingRSVPDeadline, models.AppSettingContactEmail})).
		Scan(ctx)
	if err != nil {
		return settings{}, errors.Wrap(err, "load app settings")
	}

	var out settings
	for _, row := range rows {
		switch row.Key {
		case models.AppSettingRSVPDeadline:
			deadline, err := time.Parse(time.RFC3339, row.Value)
			if err != nil {
				return settings{}, errors.Wrapf(err, "parse rsvp_deadline %q", row.Value)
			}
			out.deadline = &deadline
		case models.AppSettingContactEmail:
			out.contactEmail = pointerutil.String(row.Value)
		}
	}
	return out, nil
}

// PartyRSVPs assembles the GET /api/guest/rsvp view for one party: its guests
// in creation order, its Event RSVPs grouped by event in schedule order, and
// the deadline state. A missing party (deleted while a guest token for it was
// still live) is a 404.
func (s *Service) PartyRSVPs(ctx context.Context, partyID string) (*PartyRSVPsResponse, error) {
	return partyRSVPs(ctx, s.db, partyID)
}

// partyRSVPs is PartyRSVPs over any query context, so UpdatePartyRSVPs can
// return the refreshed view from inside its own transaction (reading its
// still-uncommitted writes).
func partyRSVPs(ctx context.Context, db bun.IDB, partyID string) (*PartyRSVPsResponse, error) {
	party := new(models.Party)
	err := db.NewSelect().Model(party).Where("p.id = ?", partyID).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("party")
		}
		return nil, errors.Wrap(err, "load party")
	}

	guests, err := partyGuests(ctx, db, partyID)
	if err != nil {
		return nil, err
	}

	cfg, err := loadSettings(ctx, db)
	if err != nil {
		return nil, err
	}

	resp := &PartyRSVPsResponse{
		PartyName:    party.Name,
		Guests:       make([]RSVPGuest, 0, len(guests)),
		Events:       []RSVPEventGroup{},
		Closed:       cfg.closed(time.Now()),
		RSVPDeadline: cfg.deadline,
		ContactEmail: cfg.contactEmail,
	}

	guestIDs := make([]string, 0, len(guests))
	for _, g := range guests {
		guestIDs = append(guestIDs, g.ID)
		resp.Guests = append(resp.Guests, RSVPGuest{
			ID:                  g.ID,
			FullName:            g.FullName,
			IsPlaceholder:       g.IsPlaceholder,
			DietaryRestrictions: g.DietaryRestrictions,
		})
	}
	if len(guestIDs) == 0 {
		return resp, nil
	}

	// Every Event RSVP row for the party's guests, with its event loaded. The
	// row's existence is the invitation (ADR 0002), so this is exactly the set
	// of (event, guest) pairs the form renders.
	var rows []*models.EventRSVP
	err = db.NewSelect().Model(&rows).
		Relation("Event").
		Where("er.guest_id IN (?)", bun.List(guestIDs)).
		Scan(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "list party event rsvps")
	}

	resp.Events = groupByEvent(rows, guestIDs)
	return resp, nil
}

// partyGuests lists a party's guests in creation order (the stable order the
// form and the admin views share).
func partyGuests(ctx context.Context, db bun.IDB, partyID string) ([]*models.Guest, error) {
	var guests []*models.Guest
	err := db.NewSelect().Model(&guests).
		Where("g.party_id = ?", partyID).
		Order("g.created_at ASC", "g.id ASC").
		Scan(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "list party guests")
	}
	return guests, nil
}

// groupByEvent folds flat Event RSVP rows into per-event groups: events in
// schedule order (date, then start time, then id, mirroring the admin event
// list), entries within an event in the party's guest order.
func groupByEvent(rows []*models.EventRSVP, guestIDs []string) []RSVPEventGroup {
	guestOrder := make(map[string]int, len(guestIDs))
	for i, id := range guestIDs {
		guestOrder[id] = i
	}

	groups := make(map[string]*RSVPEventGroup)
	for _, row := range rows {
		if row.Event == nil {
			continue // an unloadable relation row has nothing to render
		}
		group, ok := groups[row.EventID]
		if !ok {
			group = &RSVPEventGroup{Event: *row.Event, RSVPs: []RSVPEntry{}}
			groups[row.EventID] = group
		}
		group.RSVPs = append(group.RSVPs, RSVPEntry{GuestID: row.GuestID, Status: row.Status})
	}

	out := make([]RSVPEventGroup, 0, len(groups))
	for _, group := range groups {
		sort.Slice(group.RSVPs, func(i, j int) bool {
			return guestOrder[group.RSVPs[i].GuestID] < guestOrder[group.RSVPs[j].GuestID]
		})
		out = append(out, *group)
	}
	sort.Slice(out, func(i, j int) bool {
		a, b := out[i], out[j]
		if a.Date != b.Date {
			return a.Date < b.Date
		}
		if at, bt := timeOrDefault(a.StartTime), timeOrDefault(b.StartTime); at != bt {
			return at < bt
		}
		return a.ID < b.ID
	})
	return out
}

// timeOrDefault sorts events with no start time after timed ones on the same
// date, matching Postgres's ASC NULLS LAST in the admin event list.
func timeOrDefault(t *string) string {
	if t == nil {
		return "99:99"
	}
	return *t
}

// UpdatePartyRSVPs applies one whole form submission for a party: status
// changes (stamping rsvped_at for a response, clearing it for pending),
// placeholder names, and dietary restrictions, all in one transaction so a
// rejected entry leaves nothing half-applied. It enforces the RSVP deadline (a
// past deadline is a 403) and the party boundary (a guest outside the party,
// or an event the guest holds no row for, is a 422). On success it returns the
// refreshed view, read inside the same transaction.
func (s *Service) UpdatePartyRSVPs(ctx context.Context, partyID string, in UpdatePartyRSVPsPayload) (*PartyRSVPsResponse, error) {
	resp := new(PartyRSVPsResponse)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		cfg, err := loadSettings(ctx, tx)
		if err != nil {
			return err
		}
		if cfg.closed(time.Now()) {
			return errcodes.Forbidden("The RSVP deadline has passed, so responses can no longer be changed online.")
		}

		exists, err := tx.NewSelect().Model((*models.Party)(nil)).Where("id = ?", partyID).Exists(ctx)
		if err != nil {
			return errors.Wrap(err, "check party exists")
		}
		if !exists {
			return errcodes.NotFound("party")
		}

		guests, err := partyGuests(ctx, tx, partyID)
		if err != nil {
			return err
		}
		byID := make(map[string]*models.Guest, len(guests))
		for _, g := range guests {
			byID[g.ID] = g
		}

		now := time.Now()
		for _, update := range in.Guests {
			guest, ok := byID[update.GuestID]
			if !ok {
				// Never reveal whether the id exists in some other party; either way
				// it is not one of this party's guests.
				return errcodes.ValidationError("One or more guests do not belong to your party.")
			}
			if err := applyGuestUpdate(ctx, tx, guest, update, now); err != nil {
				return err
			}
		}

		refreshed, err := partyRSVPs(ctx, tx, partyID)
		if err != nil {
			return err
		}
		*resp = *refreshed
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// applyGuestUpdate writes one guest's submission inside the caller's
// transaction: the guest row (placeholder name, dietary restrictions) and one
// event_rsvps row per status entry.
func applyGuestUpdate(ctx context.Context, tx bun.Tx, guest *models.Guest, update GuestRSVPUpdate, now time.Time) error {
	// full_name only fills in placeholders (real names are admin-managed), and
	// a blank value never erases the name already on file.
	if guest.IsPlaceholder && update.FullName != nil && *update.FullName != "" {
		guest.FullName = *update.FullName
	}
	// Dietary restrictions are full-state: an absent (or blank, after trim)
	// value clears them. Blank normalizes to NULL via pointerutil.EmptyString
	// so the column never mixes "" and NULL, matching the admin PATCH path's
	// cleared-cell convention.
	guest.DietaryRestrictions = nil
	if update.DietaryRestrictions != nil {
		guest.DietaryRestrictions = pointerutil.EmptyString(*update.DietaryRestrictions)
	}
	guest.UpdatedAt = now

	_, err := tx.NewUpdate().Model(guest).
		Column("full_name", "dietary_restrictions", "updated_at").
		WherePK().Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "update guest rsvp details")
	}

	for _, entry := range update.RSVPs {
		if err := applyStatus(ctx, tx, guest.ID, entry, now); err != nil {
			return err
		}
	}
	return nil
}

// applyStatus updates one existing Event RSVP row, stamping rsvped_at for a
// response (attending / not_attending) and clearing it for pending, mirroring
// the admin override in pkg/events. A pair with no row is a 422: the row is
// the invitation (ADR 0002), so the guest API never creates one.
func applyStatus(ctx context.Context, tx bun.Tx, guestID string, entry EventRSVPUpdate, now time.Time) error {
	var rsvpedAt *time.Time
	if entry.Status != models.RSVPPending {
		rsvpedAt = pointerutil.Time(now)
	}

	res, err := tx.NewUpdate().Model((*models.EventRSVP)(nil)).
		Set("status = ?", entry.Status).
		Set("rsvped_at = ?", rsvpedAt).
		Set("updated_at = ?", now).
		Where("event_id = ?", entry.EventID).
		Where("guest_id = ?", guestID).
		Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "update event rsvp status")
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return errors.Wrap(err, "count updated event rsvps")
	}
	if affected == 0 {
		return errcodes.ValidationError("One or more RSVPs are for events this party is not invited to.")
	}
	return nil
}
