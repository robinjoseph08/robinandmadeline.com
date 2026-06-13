package migrations_test

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/migrations"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/worktree"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
	"github.com/uptrace/bun/migrate"
)

// defaultTestDatabaseURL mirrors the databasetest harness default. The
// migrations package cannot import that harness (the harness imports
// migrations), so it derives its connection details here.
const defaultTestDatabaseURL = "postgres://robinandmadeline_admin:password@localhost:5432/robinandmadeline_test?sslmode=disable"

// scratchDBName is a dedicated database for the up/down round-trip test. It is
// intentionally separate from the shared test database (robinandmadeline_test)
// because this test rolls migrations back, dropping tables; doing that on the
// shared DB could race the parties tests, which run concurrently against it. It
// is also worktree-scoped (worktree.ScopedName) so concurrent git worktrees do
// not drop and recreate it out from under each other.
var scratchDBName = worktree.ScopedName("robinandmadeline_migrations_test")

func baseDSN() string {
	if dsn := os.Getenv("TEST_DATABASE_URL"); dsn != "" {
		return dsn
	}
	return defaultTestDatabaseURL
}

func openDSN(t *testing.T, dsn string) *bun.DB {
	t.Helper()
	sqldb := sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(dsn)))
	db := bun.NewDB(sqldb, pgdialect.New())
	t.Cleanup(func() { require.NoError(t, db.Close()) })
	return db
}

// scratchDB provisions a throwaway database for this test (dropping any leftover
// from a prior run first), returns a connection to it, and drops it again on
// cleanup. Using a dedicated database keeps the destructive rollback isolated.
func scratchDB(t *testing.T) *bun.DB {
	t.Helper()

	u, err := url.Parse(baseDSN())
	require.NoError(t, err)

	admin := *u
	admin.Path = "/postgres"
	adminDB := openDSN(t, admin.String())

	ctx := context.Background()
	_, err = adminDB.ExecContext(ctx, fmt.Sprintf(`DROP DATABASE IF EXISTS %q`, scratchDBName))
	require.NoError(t, err)
	_, err = adminDB.ExecContext(ctx, fmt.Sprintf(`CREATE DATABASE %q`, scratchDBName))
	require.NoError(t, err)
	t.Cleanup(func() {
		// Drop the scratch database after the test. Best-effort: a failure here
		// should not fail the test, since the next run recreates it anyway.
		_, _ = adminDB.ExecContext(context.Background(), fmt.Sprintf(`DROP DATABASE IF EXISTS %q`, scratchDBName))
	})

	scratch := *u
	scratch.Path = "/" + scratchDBName
	return openDSN(t, scratch.String())
}

// TestMigrations_UpThenDown applies every migration against a throwaway
// database, asserts the parties/guests tables exist, rolls the group back and
// asserts they are gone, then re-applies, proving both the up and down paths are
// clean and repeatable.
func TestMigrations_UpThenDown(t *testing.T) {
	db := scratchDB(t)
	ctx := context.Background()

	_, err := migrations.BringUpToDate(ctx, db)
	require.NoError(t, err, "bring up to date")
	assert.True(t, tableExists(t, db, "parties"))
	assert.True(t, tableExists(t, db, "guests"))

	migrator := migrations.NewMigrator(db)

	rolled, err := migrator.Rollback(ctx)
	require.NoError(t, err, "rollback")
	require.NotZero(t, rolled.ID, "expected a group to roll back")
	assert.False(t, tableExists(t, db, "parties"), "parties should be dropped by down migration")
	assert.False(t, tableExists(t, db, "guests"), "guests should be dropped by down migration")

	// Re-apply to prove the up migration is repeatable after a rollback.
	_, err = migrations.BringUpToDate(ctx, db)
	require.NoError(t, err, "re-apply after rollback")
	assert.True(t, tableExists(t, db, "parties"))
}

// onLeaderboardMigrationName is the Name (the leading timestamp) of the
// migration that adds the on_leaderboard column. Bun derives a Go migration's
// Name from its filename's timestamp prefix, so this matches
// 20260614010000_add_game_sessions_on_leaderboard.go.
const onLeaderboardMigrationName = "20260614010000"

// TestOnLeaderboardMigration_BackfillsAndDropsColumn pins the one piece of the
// on_leaderboard migration that the full up-to-date harness can never exercise:
// the backfill. BringUpToDate runs against an empty database, so it has zero
// rows to backfill; the backfill only matters against the already-populated
// production database. This test reconstructs that case by applying every
// earlier migration's up (so game_sessions exists under the OLD schema, with
// display_name as the implicit opt-in), seeding rows that diverge on the name,
// then running just the on_leaderboard up and asserting the flag was backfilled
// from display_name. It then runs the down and asserts the column is dropped, so
// a regression in either direction of this single migration is caught by name
// rather than only transitively.
func TestOnLeaderboardMigration_BackfillsAndDropsColumn(t *testing.T) {
	db := scratchDB(t)
	ctx := context.Background()

	// Bun applies all pending migrations as one group, so to land the database on
	// the pre-on_leaderboard schema we run a migrator over a registry holding
	// only the EARLIER migrations (the real registered functions, copied out of
	// the package registry via Sorted), then a second migrator over the registry
	// up-to-and-including the on_leaderboard one. The shared bun_migrations
	// bookkeeping means the second run sees only the on_leaderboard migration as
	// unapplied, so it alone runs and its backfill fires against the seeded rows.
	before := migrate.NewMigrations()
	withTarget := migrate.NewMigrations()
	var found bool
	for _, m := range migrations.Migrations.Sorted() {
		withTarget.Add(m)
		if m.Name == onLeaderboardMigrationName {
			found = true
			break
		}
		before.Add(m)
	}
	require.True(t, found, "the on_leaderboard migration must be registered")

	// Phase 1: everything before on_leaderboard, so game_sessions exists under
	// its pre-on_leaderboard schema (display_name as the implicit opt-in).
	beforeMigrator := migrate.NewMigrator(db, before, migrate.WithMarkAppliedOnSuccess(true))
	require.NoError(t, beforeMigrator.Init(ctx))
	_, err := beforeMigrator.Migrate(ctx)
	require.NoError(t, err, "apply migrations before on_leaderboard")
	require.False(t, columnExists(t, db, "game_sessions", "on_leaderboard"), "precondition: the column does not exist yet")

	// Seed two completed solves that diverge on the name: one posted under the
	// old implicit rule (display_name set), one completed-but-unposted (NULL).
	// The named row is the faster of the two, so an un-backfilled (all-false)
	// flag would be observably wrong on any later leaderboard read.
	_, err = db.ExecContext(ctx, `
		INSERT INTO game_sessions (id, puzzle_id, ip_address, difficulty, elapsed_ms, completed_at, display_name, created_at, updated_at)
		VALUES
			('00000000-0000-4000-8000-000000000001', 'wedding-mini-v1', '203.0.113.7', 'easy', 5000, now(), 'Posted Pat', now(), now()),
			('00000000-0000-4000-8000-000000000002', 'wedding-mini-v1', '203.0.113.7', 'easy', 9000, now(), NULL, now(), now())
	`)
	require.NoError(t, err)

	// Phase 2: apply the on_leaderboard migration (the only one still unapplied).
	// It adds the column and backfills the flag from display_name.
	targetMigrator := migrate.NewMigrator(db, withTarget, migrate.WithMarkAppliedOnSuccess(true))
	require.NoError(t, targetMigrator.Init(ctx))
	_, err = targetMigrator.Migrate(ctx)
	require.NoError(t, err, "apply the on_leaderboard migration")
	assert.True(t, columnExists(t, db, "game_sessions", "on_leaderboard"), "the column is added")

	flag := func(id string) bool {
		t.Helper()
		var on bool
		require.NoError(t, db.NewRaw(
			"SELECT on_leaderboard FROM game_sessions WHERE id = ?", id,
		).Scan(ctx, &on))
		return on
	}
	assert.True(t, flag("00000000-0000-4000-8000-000000000001"), "the named row is backfilled onto the board")
	assert.False(t, flag("00000000-0000-4000-8000-000000000002"), "the unnamed row stays off the board")

	// The down reverses cleanly: rolling the last group back drops the column
	// (its backfilled data discarded with it).
	_, err = targetMigrator.Rollback(ctx)
	require.NoError(t, err, "roll the on_leaderboard migration back")
	assert.False(t, columnExists(t, db, "game_sessions", "on_leaderboard"), "the down drops the column")
}

// tableExists reports whether a table is present in the public schema.
func tableExists(t *testing.T, db *bun.DB, name string) bool {
	t.Helper()
	var exists bool
	err := db.NewRaw(
		"SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?)",
		name,
	).Scan(context.Background(), &exists)
	require.NoError(t, err)
	return exists
}

// columnExists reports whether a column is present on a table in the public
// schema.
func columnExists(t *testing.T, db *bun.DB, table, column string) bool {
	t.Helper()
	var exists bool
	err := db.NewRaw(
		"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND column_name = ?)",
		table, column,
	).Scan(context.Background(), &exists)
	require.NoError(t, err)
	return exists
}
