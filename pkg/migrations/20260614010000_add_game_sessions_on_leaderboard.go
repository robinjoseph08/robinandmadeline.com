package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

// This file's 20260614010000 timestamp is deliberately ahead of the calendar
// for the same reason the create migration's 20260614000000 is (see that file),
// and it MUST sort strictly after 20260614000000: on a fresh database (CI, the
// shared test database, the e2e database) Bun creates tables in name-sort order,
// so this ALTER has to run after the CREATE that introduces game_sessions. Bun
// applies whichever registered migrations are still unapplied regardless of how
// their names sort, so the future date is harmless and must not be "corrected"
// to the authoring date; only the ordering relative to the create migration
// matters.
func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// on_leaderboard is the EXPLICIT leaderboard opt-in, replacing the old
		// implicit "display_name IS NOT NULL" rule. We collect every completed
		// solve's time (completed_at + elapsed_ms) regardless of whether the
		// solver posted, and this flag alone says whether they chose to appear
		// on the leaderboard. display_name stays the name shown when opting in
		// (and is kept for retroactive party affiliation), but it is no longer
		// what gates visibility. An upcoming admin view lists every session,
		// including completed-but-not-opted-in ones, which is why the opt-in
		// needs to be a column we can see and filter, not an inference.
		//
		// DEFAULT false is correct for a brand-new session (a solve starts not
		// on the leaderboard); the NOT NULL keeps it a clean two-state flag.
		_, err := db.ExecContext(ctx, `
			ALTER TABLE game_sessions
			ADD COLUMN on_leaderboard BOOLEAN NOT NULL DEFAULT false
		`)
		if err != nil {
			return fmt.Errorf("add game_sessions on_leaderboard column: %w", err)
		}

		// Backfill maps the old implicit opt-ins forward: every row that had a
		// display_name under the previous rule was a posted, visible entry, so
		// it must stay on the leaderboard now that the flag, not the name, gates
		// visibility. Without this, every previously-posted entry would vanish
		// from the board the moment this migration lands.
		_, err = db.ExecContext(ctx, `
			UPDATE game_sessions SET on_leaderboard = true WHERE display_name IS NOT NULL
		`)
		if err != nil {
			return fmt.Errorf("backfill game_sessions on_leaderboard: %w", err)
		}

		// Enforce the cross-column invariant the reads depend on: an on-board row
		// always carries a display_name. The list and viewer-rank reads filter on
		// on_leaderboard and then dereference display_name, so this is the
		// model-level guarantee (pkg/CLAUDE.md: a must-always-hold invariant
		// belongs on a DB constraint, not in handlers) that keeps a stray future
		// write from making a NULL name reachable as a 500. The backfill above
		// just established it for every existing row, so the constraint validates
		// cleanly. off-board rows (on_leaderboard false) are unconstrained, so the
		// "collect every completed time" rows with no name are still allowed.
		_, err = db.ExecContext(ctx, `
			ALTER TABLE game_sessions
			ADD CONSTRAINT game_sessions_on_leaderboard_needs_name
			CHECK (NOT on_leaderboard OR display_name IS NOT NULL)
		`)
		if err != nil {
			return fmt.Errorf("add game_sessions on_leaderboard display_name check: %w", err)
		}

		// Re-key the partial leaderboard index off the new flag so it still
		// covers exactly the visible slice (opted-in, completed sessions for one
		// puzzle, fastest first) and abandoned/unposted sessions never bloat it.
		// The old index keyed off display_name IS NOT NULL; that predicate is
		// now equivalent to on_leaderboard (the backfill set the flag exactly
		// where display_name was non-NULL, and a post sets both together), but
		// the index must track the column the read now filters on.
		_, err = db.ExecContext(ctx, `DROP INDEX ix_game_sessions_leaderboard`)
		if err != nil {
			return fmt.Errorf("drop old game_sessions leaderboard index: %w", err)
		}
		_, err = db.ExecContext(ctx, `
			CREATE INDEX ix_game_sessions_leaderboard
			ON game_sessions (puzzle_id, elapsed_ms)
			WHERE on_leaderboard AND completed_at IS NOT NULL
		`)
		if err != nil {
			return fmt.Errorf("create game_sessions leaderboard index: %w", err)
		}

		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		// Reverse in the opposite order: restore the original index (keyed off
		// the implicit display_name rule), then drop the column. The data the
		// backfill wrote is discarded with the column; the original index keys
		// off display_name IS NOT NULL again, which is where the rows the
		// backfill marked came from, so the leaderboard read reverts cleanly.
		_, err := db.ExecContext(ctx, `DROP INDEX ix_game_sessions_leaderboard`)
		if err != nil {
			return fmt.Errorf("drop game_sessions leaderboard index: %w", err)
		}
		_, err = db.ExecContext(ctx, `
			CREATE INDEX ix_game_sessions_leaderboard
			ON game_sessions (puzzle_id, elapsed_ms)
			WHERE display_name IS NOT NULL AND completed_at IS NOT NULL
		`)
		if err != nil {
			return fmt.Errorf("recreate original game_sessions leaderboard index: %w", err)
		}
		// Drop the cross-column check before the column. Postgres would cascade it
		// away with the column anyway (it references on_leaderboard), but dropping
		// it explicitly keeps the down self-documenting and order-independent.
		_, err = db.ExecContext(ctx, `
			ALTER TABLE game_sessions DROP CONSTRAINT IF EXISTS game_sessions_on_leaderboard_needs_name
		`)
		if err != nil {
			return fmt.Errorf("drop game_sessions on_leaderboard display_name check: %w", err)
		}
		_, err = db.ExecContext(ctx, `ALTER TABLE game_sessions DROP COLUMN on_leaderboard`)
		if err != nil {
			return fmt.Errorf("drop game_sessions on_leaderboard column: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
