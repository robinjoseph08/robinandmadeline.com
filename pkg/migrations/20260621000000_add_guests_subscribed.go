package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// subscribed is the per-guest Email Subscription flag (CONTEXT.md, ADR
		// 0009): whether a guest receives the couple's broadcast email updates.
		// DEFAULT true preserves today's behavior, where every guest with an
		// email address is mailed, so existing rows backfill to subscribed
		// without a separate UPDATE. NOT NULL keeps it a clean two-state flag:
		// unsubscribing flips it to false (the email footer link, the info-form
		// checkbox, or the admin edit) and resubscribing flips it back.
		_, err := db.ExecContext(ctx, `ALTER TABLE guests ADD COLUMN subscribed BOOLEAN NOT NULL DEFAULT true`)
		if err != nil {
			return fmt.Errorf("add guests subscribed column: %w", err)
		}
		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		_, err := db.ExecContext(ctx, `ALTER TABLE guests DROP COLUMN IF EXISTS subscribed`)
		if err != nil {
			return fmt.Errorf("drop guests subscribed column: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
