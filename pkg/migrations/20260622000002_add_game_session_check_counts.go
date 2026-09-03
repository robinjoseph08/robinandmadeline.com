package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

// Record each kind of explicit crossword check separately. The retained zero
// defaults keep older application instances able to create and update sessions
// while a rolling deployment is in progress.
func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			_, err := tx.ExecContext(ctx, `
				ALTER TABLE game_sessions
				ADD COLUMN square_checks BIGINT NOT NULL DEFAULT 0,
				ADD COLUMN word_checks BIGINT NOT NULL DEFAULT 0,
				ADD COLUMN grid_checks BIGINT NOT NULL DEFAULT 0,
				ADD CONSTRAINT game_sessions_square_checks_nonnegative CHECK (square_checks >= 0),
				ADD CONSTRAINT game_sessions_word_checks_nonnegative CHECK (word_checks >= 0),
				ADD CONSTRAINT game_sessions_grid_checks_nonnegative CHECK (grid_checks >= 0)
			`)
			if err != nil {
				return fmt.Errorf("add game_sessions check count columns: %w", err)
			}
			return nil
		})
	}

	down := func(ctx context.Context, db *bun.DB) error {
		_, err := db.ExecContext(ctx, `
			ALTER TABLE game_sessions
			DROP COLUMN square_checks,
			DROP COLUMN word_checks,
			DROP COLUMN grid_checks
		`)
		if err != nil {
			return fmt.Errorf("drop game_sessions check count columns: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
