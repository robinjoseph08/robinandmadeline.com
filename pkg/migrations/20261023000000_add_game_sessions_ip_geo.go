package migrations

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/uptrace/bun"
)

// Store where each solve's IP was when it was captured, so the admin view can
// show a location and ISP without a manual lookup. A background resolver fills
// the columns after the session is created; ip_geo_looked_up_at stays NULL
// until it has, which is also how existing rows get backfilled. The location is
// stored rather than looked up on read because IP assignments drift over time,
// and the location at solve time is the one that matters.
func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			_, err := tx.ExecContext(ctx, `
				ALTER TABLE game_sessions
				ADD COLUMN ip_city TEXT NOT NULL DEFAULT '',
				ADD COLUMN ip_region TEXT NOT NULL DEFAULT '',
				ADD COLUMN ip_country TEXT NOT NULL DEFAULT '',
				ADD COLUMN ip_org TEXT NOT NULL DEFAULT '',
				ADD COLUMN ip_geo_looked_up_at TIMESTAMPTZ
			`)
			if err != nil {
				return fmt.Errorf("add game_sessions ip geo columns: %w", err)
			}

			// The resolver's pending scan and its same-IP reuse lookup both key
			// on ip_address.
			_, err = tx.ExecContext(ctx, `
				CREATE INDEX ix_game_sessions_ip_address ON game_sessions (ip_address)
			`)
			if err != nil {
				return fmt.Errorf("create game_sessions ip_address index: %w", err)
			}
			return nil
		})
	}

	down := func(ctx context.Context, db *bun.DB) error {
		return db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
			if _, err := tx.ExecContext(ctx, `DROP INDEX IF EXISTS ix_game_sessions_ip_address`); err != nil {
				return fmt.Errorf("drop game_sessions ip_address index: %w", err)
			}
			_, err := tx.ExecContext(ctx, `
				ALTER TABLE game_sessions
				DROP COLUMN ip_city,
				DROP COLUMN ip_region,
				DROP COLUMN ip_country,
				DROP COLUMN ip_org,
				DROP COLUMN ip_geo_looked_up_at
			`)
			if err != nil {
				return fmt.Errorf("drop game_sessions ip geo columns: %w", err)
			}
			return nil
		})
	}

	Migrations.MustRegister(up, down)
}
