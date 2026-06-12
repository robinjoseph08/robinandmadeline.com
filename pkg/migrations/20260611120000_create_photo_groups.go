package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// photo_groups: a named set of guests needed together for a specific
		// photo, with a shooting order. All group photos happen in the one
		// session between the ceremony and the reception, so groups form a
		// single global list rather than belonging to an event. sort_order is
		// the position within that list; the API appends new groups at the end
		// and the reorder endpoint rewrites the whole sequence, so values stay
		// small integers but are not guaranteed contiguous (reads rank by
		// sort_order rather than trusting the raw value).
		_, err := db.ExecContext(ctx, `
			CREATE TABLE photo_groups (
				id UUID PRIMARY KEY,
				name TEXT NOT NULL,
				sort_order INT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)
		if err != nil {
			return fmt.Errorf("create photo_groups table: %w", err)
		}

		// photo_group_assignments: membership of one guest in one photo group.
		// The composite primary key is the natural key (a guest is in a group
		// once) and doubles as the target of the add endpoint's ON CONFLICT DO
		// NOTHING, making re-adding idempotent. Both FKs cascade so deleting a
		// group or a guest removes the memberships.
		_, err = db.ExecContext(ctx, `
			CREATE TABLE photo_group_assignments (
				photo_group_id UUID NOT NULL REFERENCES photo_groups (id) ON DELETE CASCADE,
				guest_id UUID NOT NULL REFERENCES guests (id) ON DELETE CASCADE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (photo_group_id, guest_id)
			)
		`)
		if err != nil {
			return fmt.Errorf("create photo_group_assignments table: %w", err)
		}

		// The guest-facing photos section looks memberships up by guest (via
		// the party's guests); photo_group_id is covered by the primary key's
		// leading column.
		_, err = db.ExecContext(ctx, `CREATE INDEX ix_photo_group_assignments_guest_id ON photo_group_assignments (guest_id)`)
		if err != nil {
			return fmt.Errorf("create photo_group_assignments guest_id index: %w", err)
		}

		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		// photo_group_assignments first: it references photo_groups.
		_, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS photo_group_assignments`)
		if err != nil {
			return fmt.Errorf("drop photo_group_assignments table: %w", err)
		}
		_, err = db.ExecContext(ctx, `DROP TABLE IF EXISTS photo_groups`)
		if err != nil {
			return fmt.Errorf("drop photo_groups table: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
