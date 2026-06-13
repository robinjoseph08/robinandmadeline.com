package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// attempted_at records when the worker last claimed the row for a
		// dispatch attempt against Mailgun. It is the durable basis for the
		// daily send budget (Mailgun's free plan caps sends per UTC day):
		// counting rows attempted since UTC midnight tells the worker how much
		// of today's budget is spent. A requeued row keeps its last attempt
		// timestamp until the next claim overwrites it, so each day's count
		// reflects that day's attempts.
		//
		// quota_requeues counts how many times a quota-classified Mailgun
		// rejection has requeued the row. It bounds the retry loop: once the
		// count exceeds the worker's cap the row is failed instead, so a
		// rejection misclassified as quota surfaces as a visible failure
		// rather than stalling the head of the queue forever.
		_, err := db.ExecContext(ctx, `
			ALTER TABLE email_recipients
				ADD COLUMN attempted_at TIMESTAMPTZ,
				ADD COLUMN quota_requeues INT NOT NULL DEFAULT 0
		`)
		if err != nil {
			return fmt.Errorf("add email_recipients attempt tracking columns: %w", err)
		}

		// The daily-budget count scans attempted_at >= today's UTC midnight.
		// Partial: rows never attempted (the bulk of a fresh send) carry NULL
		// and can never match the range predicate.
		_, err = db.ExecContext(ctx, `CREATE INDEX ix_email_recipients_attempted_at ON email_recipients (attempted_at) WHERE attempted_at IS NOT NULL`)
		if err != nil {
			return fmt.Errorf("create email_recipients attempted_at index: %w", err)
		}

		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		// Dropping attempted_at drops its index with it.
		_, err := db.ExecContext(ctx, `
			ALTER TABLE email_recipients
				DROP COLUMN IF EXISTS attempted_at,
				DROP COLUMN IF EXISTS quota_requeues
		`)
		if err != nil {
			return fmt.Errorf("drop email_recipients attempt tracking columns: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
