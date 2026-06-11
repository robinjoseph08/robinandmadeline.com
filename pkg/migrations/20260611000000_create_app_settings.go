package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// app_settings: a tiny key/value table for site-wide settings the admin
		// edits from the dashboard. Today it carries two keys read by the guest
		// RSVP flow: rsvp_deadline (an RFC3339 timestamp; absent means RSVPs stay
		// open) and contact_email (shown in the post-deadline "contact us"
		// message). No rows are seeded: an absent key is a valid state with
		// defined semantics, so the table starts empty.
		_, err := db.ExecContext(ctx, `
			CREATE TABLE app_settings (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			)
		`)
		if err != nil {
			return fmt.Errorf("create app_settings table: %w", err)
		}
		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		_, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS app_settings`)
		if err != nil {
			return fmt.Errorf("drop app_settings table: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
