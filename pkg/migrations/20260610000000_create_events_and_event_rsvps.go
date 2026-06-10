package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// events: a scheduled wedding activity (Ceremony, Reception, ...).
		//
		// date is a calendar date (DATE, no timezone games); start_time/end_time
		// are nullable "HH:MM" strings rather than TIME columns because they are
		// display values the couple types in, validated at the API boundary.
		// is_public decides invitation semantics (ADR 0002): a public event is
		// visible to everyone and every guest gets an Event RSVP row; a private
		// event only gets rows for explicitly invited parties. sort_order drives
		// the schedule's display order (date alone cannot order two events on the
		// same day).
		_, err := db.ExecContext(ctx, `
			CREATE TABLE events (
				id UUID PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT,
				location TEXT,
				date DATE NOT NULL,
				start_time TEXT,
				end_time TEXT,
				is_public BOOLEAN NOT NULL DEFAULT FALSE,
				sort_order INTEGER NOT NULL DEFAULT 0,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)
		if err != nil {
			return fmt.Errorf("create events table: %w", err)
		}

		// event_rsvps: a guest's per-event response. The existence of a row is the
		// invitation (ADR 0002): there is no separate invitations table, and a
		// fresh row starts pending. rsvped_at records when the guest (or the admin
		// on their behalf) responded; a pending row has never been responded to,
		// so it stays NULL.
		//
		// status is TEXT guarded by a CHECK constraint rather than a native PG
		// enum, matching parties.side/relation: cheap to evolve, friendlier app
		// errors. Both FKs cascade so deleting an event or a guest removes the
		// dependent rows.
		_, err = db.ExecContext(ctx, `
			CREATE TABLE event_rsvps (
				id UUID PRIMARY KEY,
				event_id UUID NOT NULL REFERENCES events (id) ON DELETE CASCADE,
				guest_id UUID NOT NULL REFERENCES guests (id) ON DELETE CASCADE,
				status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'attending', 'not_attending')),
				rsvped_at TIMESTAMPTZ,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)
		if err != nil {
			return fmt.Errorf("create event_rsvps table: %w", err)
		}

		// One Event RSVP per guest per event. The unique index doubles as the
		// target of the auto-creation paths' ON CONFLICT DO NOTHING, making the
		// backfills idempotent, and as the event_id lookup index.
		_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX ux_event_rsvps_event_guest ON event_rsvps (event_id, guest_id)`)
		if err != nil {
			return fmt.Errorf("create event_rsvps event/guest index: %w", err)
		}

		// Fetching a guest's RSVPs (the RSVP flow, the guest-list filters) looks
		// up by guest; event_id is covered by the unique index's leading column.
		_, err = db.ExecContext(ctx, `CREATE INDEX ix_event_rsvps_guest_id ON event_rsvps (guest_id)`)
		if err != nil {
			return fmt.Errorf("create event_rsvps guest_id index: %w", err)
		}

		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		// event_rsvps first: it references events.
		_, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS event_rsvps`)
		if err != nil {
			return fmt.Errorf("drop event_rsvps table: %w", err)
		}
		_, err = db.ExecContext(ctx, `DROP TABLE IF EXISTS events`)
		if err != nil {
			return fmt.Errorf("drop events table: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
