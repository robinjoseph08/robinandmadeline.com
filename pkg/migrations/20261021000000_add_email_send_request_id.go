package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// request_id is the compose page's idempotency key for a send: the page
		// generates one per send attempt and repeats it on a retry, so a retry
		// after a lost response returns the send that already went out instead
		// of queueing every guest a second copy. Nullable because older sends
		// (and direct API calls) have none; unique only where set.
		_, err := db.ExecContext(ctx, `ALTER TABLE email_sends ADD COLUMN request_id UUID`)
		if err != nil {
			return fmt.Errorf("add email_sends request_id column: %w", err)
		}
		_, err = db.ExecContext(ctx, `CREATE UNIQUE INDEX ux_email_sends_request_id ON email_sends (request_id) WHERE request_id IS NOT NULL`)
		if err != nil {
			return fmt.Errorf("create email_sends request_id index: %w", err)
		}
		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		_, err := db.ExecContext(ctx, `ALTER TABLE email_sends DROP COLUMN IF EXISTS request_id`)
		if err != nil {
			return fmt.Errorf("drop email_sends request_id column: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
