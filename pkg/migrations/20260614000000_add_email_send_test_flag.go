package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// is_test marks a send the couple triggered from the compose page's
		// "Send test" button: a real send through the same queue and worker,
		// but addressed to the couple's own inboxes (EMAIL_TEST_RECIPIENTS)
		// instead of the filtered guest audience. Flagging it lets the history
		// badge and filter tell test sends apart from the real ones, while it
		// otherwise reuses quota counting, the delivery webhook, and the send
		// history for free. Defaults false so every existing send is a real
		// send.
		_, err := db.ExecContext(ctx, `ALTER TABLE email_sends ADD COLUMN is_test BOOLEAN NOT NULL DEFAULT false`)
		if err != nil {
			return fmt.Errorf("add email_sends is_test column: %w", err)
		}
		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		_, err := db.ExecContext(ctx, `ALTER TABLE email_sends DROP COLUMN IF EXISTS is_test`)
		if err != nil {
			return fmt.Errorf("drop email_sends is_test column: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
