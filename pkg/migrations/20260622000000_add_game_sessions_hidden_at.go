package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

// Hidden leaderboard entries need a first-class moderation marker. Keeping
// hidden_at separate from on_leaderboard distinguishes an admin-hidden solve
// from one the solver never posted, and lets a database constraint prevent an
// older application binary from making a hidden row public again.
func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			_, err := tx.ExecContext(ctx, `
				ALTER TABLE game_sessions
				ADD COLUMN hidden_at TIMESTAMPTZ NULL
			`)
			if err != nil {
				return fmt.Errorf("add game_sessions hidden_at column: %w", err)
			}

			_, err = tx.ExecContext(ctx, `
				ALTER TABLE game_sessions
				ADD CONSTRAINT game_sessions_hidden_not_on_leaderboard
				CHECK (
					hidden_at IS NULL
					OR (NOT on_leaderboard AND display_name IS NOT NULL)
				)
			`)
			if err != nil {
				return fmt.Errorf("add game_sessions hidden visibility check: %w", err)
			}
			return nil
		})
	}

	down := func(ctx context.Context, db *bun.DB) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			// Removing hidden_at while moderated rows exist would let an older app
			// treat them as ordinary unposted solves and publish them again. Refuse
			// that destructive rollback rather than silently weakening privacy.
			hidden, err := tx.NewSelect().Model((*struct{})(nil)).
				Table("game_sessions").
				Where("hidden_at IS NOT NULL").
				Count(ctx)
			if err != nil {
				return fmt.Errorf("count hidden game sessions before rollback: %w", err)
			}
			if hidden > 0 {
				return fmt.Errorf("cannot drop game_sessions hidden_at while %d hidden sessions exist", hidden)
			}

			_, err = tx.ExecContext(ctx, `
				ALTER TABLE game_sessions
				DROP CONSTRAINT IF EXISTS game_sessions_hidden_not_on_leaderboard
			`)
			if err != nil {
				return fmt.Errorf("drop game_sessions hidden visibility check: %w", err)
			}
			_, err = tx.ExecContext(ctx, `ALTER TABLE game_sessions DROP COLUMN hidden_at`)
			if err != nil {
				return fmt.Errorf("drop game_sessions hidden_at column: %w", err)
			}
			return nil
		})
	}

	Migrations.MustRegister(up, down)
}
