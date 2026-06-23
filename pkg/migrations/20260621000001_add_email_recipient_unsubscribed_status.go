package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// Widen the email_recipients.status CHECK to admit 'unsubscribed', the
		// terminal status the worker records when a guest unsubscribed between a
		// send's enqueue and its dispatch (ADR 0009): the row is intentionally
		// not sent, kept distinct from a delivery 'failed'. The inline column
		// CHECK from the create migration is auto-named
		// email_recipients_status_check.
		_, err := db.ExecContext(ctx, `
			ALTER TABLE email_recipients
			DROP CONSTRAINT email_recipients_status_check,
			ADD CONSTRAINT email_recipients_status_check
			CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'unsubscribed'))
		`)
		if err != nil {
			return fmt.Errorf("widen email_recipients status check: %w", err)
		}
		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		// Fold any 'unsubscribed' rows back to 'failed' (the closest pre-existing
		// terminal status) so the narrower constraint applies cleanly, then
		// restore the original status set.
		_, err := db.ExecContext(ctx, `UPDATE email_recipients SET status = 'failed' WHERE status = 'unsubscribed'`)
		if err != nil {
			return fmt.Errorf("fold unsubscribed rows before narrowing status check: %w", err)
		}
		_, err = db.ExecContext(ctx, `
			ALTER TABLE email_recipients
			DROP CONSTRAINT email_recipients_status_check,
			ADD CONSTRAINT email_recipients_status_check
			CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed'))
		`)
		if err != nil {
			return fmt.Errorf("narrow email_recipients status check: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
