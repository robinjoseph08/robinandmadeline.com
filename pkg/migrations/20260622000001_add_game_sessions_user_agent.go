package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

// Solve sessions already capture the client IP for abuse tracing. Capture the
// server-observed User-Agent alongside it so the admin view has more context
// when reviewing suspicious or duplicate solves.
func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			_, err := tx.ExecContext(ctx, `
				ALTER TABLE game_sessions
				ADD COLUMN user_agent TEXT NOT NULL DEFAULT ''
			`)
			if err != nil {
				return fmt.Errorf("add game_sessions user_agent column: %w", err)
			}

			// Keep the empty-string default so older application instances can omit
			// user_agent while a rolling deployment is in progress.
			return nil
		})
	}

	down := func(ctx context.Context, db *bun.DB) error {
		_, err := db.ExecContext(ctx, `ALTER TABLE game_sessions DROP COLUMN user_agent`)
		if err != nil {
			return fmt.Errorf("drop game_sessions user_agent column: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
