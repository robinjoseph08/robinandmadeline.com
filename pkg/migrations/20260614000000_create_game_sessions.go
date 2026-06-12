package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// game_sessions: one server-timed crossword solve. A row is created when
		// a guest starts a puzzle and updated as they solve, so a row whose
		// completed_at is NULL is a started-but-never-finished solve (observable
		// as such, not inferred client-side).
		//
		// id is a UUID that doubles as the session's bearer token: the crossword
		// needs no authentication, so holding the id is what authorizes updates.
		// puzzle_id is the client-side puzzle slug (e.g. "wedding-mini-v1"); the
		// puzzles themselves live in frontend code, so there is no puzzles table
		// to reference. party_id is captured opportunistically when the request
		// carries a valid guest token and stays NULL otherwise; ON DELETE SET
		// NULL keeps anonymous solve history when a party is deleted. difficulty
		// records the EASIEST level used at any point during the solve (easy <
		// medium < hard); the CHECK guards the closed set like other TEXT enums.
		// elapsed_ms is the accumulated active-solving time the client reports;
		// it only ever grows (enforced in the service). display_name being
		// non-NULL is the leaderboard opt-in: it is set once, post-completion,
		// and kept even for signed-in parties so an anonymous entry can be
		// retroactively affiliated later.
		_, err := db.ExecContext(ctx, `
			CREATE TABLE game_sessions (
				id UUID PRIMARY KEY,
				puzzle_id TEXT NOT NULL,
				party_id UUID REFERENCES parties (id) ON DELETE SET NULL,
				ip_address TEXT NOT NULL,
				difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
				elapsed_ms BIGINT NOT NULL DEFAULT 0 CHECK (elapsed_ms >= 0),
				completed_at TIMESTAMPTZ,
				display_name TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)
		if err != nil {
			return fmt.Errorf("create game_sessions table: %w", err)
		}

		// The leaderboard read: posted (display_name set), completed sessions for
		// one puzzle, fastest first. The partial index covers exactly that slice,
		// so abandoned and unposted sessions never bloat it.
		_, err = db.ExecContext(ctx, `
			CREATE INDEX ix_game_sessions_leaderboard
			ON game_sessions (puzzle_id, elapsed_ms)
			WHERE display_name IS NOT NULL AND completed_at IS NOT NULL
		`)
		if err != nil {
			return fmt.Errorf("create game_sessions leaderboard index: %w", err)
		}

		// Postgres does not index FK columns automatically; without this, every
		// party delete (ON DELETE SET NULL) would scan the whole table.
		_, err = db.ExecContext(ctx, `CREATE INDEX ix_game_sessions_party_id ON game_sessions (party_id)`)
		if err != nil {
			return fmt.Errorf("create game_sessions party_id index: %w", err)
		}

		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		_, err := db.ExecContext(ctx, `DROP TABLE IF EXISTS game_sessions`)
		if err != nil {
			return fmt.Errorf("drop game_sessions table: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
