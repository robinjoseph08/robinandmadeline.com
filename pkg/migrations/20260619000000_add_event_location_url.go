package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// location_url is the optional Location Link: a couple-provided URL
		// attached to an event's location (typically a Google Maps or directions
		// page) that the guest schedule renders the location label as a hyperlink
		// to. Nullable like location, so an event may have neither, a label only,
		// or a label plus a link. The "a link cannot exist without a label"
		// invariant is enforced at the API boundary (the events service), not as a
		// column constraint, so the schema stays a plain nullable column.
		_, err := db.ExecContext(ctx, `ALTER TABLE events ADD COLUMN location_url TEXT`)
		if err != nil {
			return fmt.Errorf("add events.location_url column: %w", err)
		}
		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		_, err := db.ExecContext(ctx, `ALTER TABLE events DROP COLUMN IF EXISTS location_url`)
		if err != nil {
			return fmt.Errorf("drop events.location_url column: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
