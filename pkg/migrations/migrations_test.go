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
// 20260614130000_add_game_sessions_on_leaderboard.go.
const onLeaderboardMigrationName = "20260614130000"

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
func TestHiddenGameSessionMigration_RefusesRollbackWhileModeratedRowsExist(t *testing.T) {
	db := scratchDB(t)
	ctx := context.Background()

	// Apply every migration before hidden_at as one group, then hidden_at alone
	// as a second group. Rolling back the second group must leave game_sessions
	// intact so its privacy-preserving data transform can be observed.
	before := migrate.NewMigrations()
	withTarget := migrate.NewMigrations()
	var found bool
	for _, m := range migrations.Migrations.Sorted() {
		withTarget.Add(m)
		if m.Name == "20260622000000" {
			found = true
			break
		}
		before.Add(m)
	}
	require.True(t, found, "the hidden_at migration must be registered")

	beforeMigrator := migrate.NewMigrator(db, before, migrate.WithMarkAppliedOnSuccess(true))
	require.NoError(t, beforeMigrator.Init(ctx))
	_, err := beforeMigrator.Migrate(ctx)
	require.NoError(t, err, "apply migrations before hidden_at")
	require.False(t, columnExists(t, db, "hidden_at"))

	targetMigrator := migrate.NewMigrator(db, withTarget, migrate.WithMarkAppliedOnSuccess(true))
	require.NoError(t, targetMigrator.Init(ctx))
	_, err = targetMigrator.Migrate(ctx)
	require.NoError(t, err, "apply hidden_at migration")
	require.True(t, columnExists(t, db, "hidden_at"))

	stamp := "2026-06-22T12:00:00Z"
	_, err = db.ExecContext(ctx, `
		INSERT INTO game_sessions (
			id, puzzle_id, ip_address, difficulty, elapsed_ms, completed_at,
			on_leaderboard, display_name, hidden_at, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`,
		"00000000-0000-4000-8000-0000000000aa",
		"wedding-mini-v1",
		"203.0.113.7",
		"easy",
		5000,
		stamp,
		false,
		"Hidden Robin",
		stamp,
		stamp,
		stamp,
	)
	require.NoError(t, err)

	_, err = targetMigrator.Rollback(ctx)
	require.Error(t, err, "rollback must refuse to discard the moderation marker")
	assert.Contains(t, err.Error(), "cannot drop game_sessions hidden_at while 1 hidden sessions exist")
	assert.True(t, tableExists(t, db, "game_sessions"))
	assert.True(t, columnExists(t, db, "hidden_at"), "the transaction keeps the moderation column when rollback is refused")

	var hiddenAt *string
	require.NoError(t, db.NewRaw(
		"SELECT hidden_at::text FROM game_sessions WHERE id = ?",
		"00000000-0000-4000-8000-0000000000aa",
	).Scan(ctx, &hiddenAt))
	assert.NotNil(t, hiddenAt, "the moderated row remains marked hidden")

	// Once the moderated row is explicitly removed, the down migration can run
	// cleanly. This proves the refusal is data-dependent, not an unusable down.
	_, err = db.NewDelete().Table("game_sessions").
		Where("id = ?", "00000000-0000-4000-8000-0000000000aa").
		Exec(ctx)
	require.NoError(t, err)
	_, err = targetMigrator.Rollback(ctx)
	require.NoError(t, err, "rollback after removing hidden rows")
	assert.False(t, columnExists(t, db, "hidden_at"))
}

func TestGameSessionUserAgentMigration_BackfillsAndDropsColumn(t *testing.T) {
	db := scratchDB(t)
	ctx := context.Background()

	before := migrate.NewMigrations()
	withTarget := migrate.NewMigrations()
	var found bool
	for _, m := range migrations.Migrations.Sorted() {
		withTarget.Add(m)
		if m.Name == "20260622000001" {
			found = true
			break
		}
		before.Add(m)
	}
	require.True(t, found, "the user_agent migration must be registered")

	beforeMigrator := migrate.NewMigrator(db, before, migrate.WithMarkAppliedOnSuccess(true))
	require.NoError(t, beforeMigrator.Init(ctx))
	_, err := beforeMigrator.Migrate(ctx)
	require.NoError(t, err, "apply migrations before user_agent")
	require.False(t, columnExists(t, db, "user_agent"))

	_, err = db.ExecContext(ctx, `
		INSERT INTO game_sessions (
			id, puzzle_id, ip_address, difficulty, elapsed_ms, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, now(), now())
	`,
		"00000000-0000-4000-8000-0000000000bb",
		"wedding-mini-v1",
		"203.0.113.7",
		"easy",
		5000,
	)
	require.NoError(t, err)

	targetMigrator := migrate.NewMigrator(db, withTarget, migrate.WithMarkAppliedOnSuccess(true))
	require.NoError(t, targetMigrator.Init(ctx))
	_, err = targetMigrator.Migrate(ctx)
	require.NoError(t, err, "apply user_agent migration")
	require.True(t, columnExists(t, db, "user_agent"))

	var userAgent string
	require.NoError(t, db.NewRaw(
		"SELECT user_agent FROM game_sessions WHERE id = ?",
		"00000000-0000-4000-8000-0000000000bb",
	).Scan(ctx, &userAgent))
	assert.Empty(t, userAgent, "existing sessions are backfilled with an empty user agent")

	var columnDefault *string
	require.NoError(t, db.NewRaw(`
		SELECT column_default
		FROM information_schema.columns
		WHERE table_schema = 'public'
			AND table_name = 'game_sessions'
			AND column_name = 'user_agent'
	`).Scan(ctx, &columnDefault))
	require.NotNil(t, columnDefault, "the default must remain for rolling-deployment compatibility")
	assert.Equal(t, "''::text", *columnDefault)

	// Simulate an older application binary writing after the migration. It does
	// not know about user_agent, so the retained default must keep the insert
	// compatible while the deployment rolls forward.
	_, err = db.ExecContext(ctx, `
		INSERT INTO game_sessions (
			id, puzzle_id, ip_address, difficulty, elapsed_ms, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, now(), now())
	`,
		"00000000-0000-4000-8000-0000000000cc",
		"wedding-mini-v1",
		"203.0.113.8",
		"medium",
		7000,
	)
	require.NoError(t, err, "an old writer can omit user_agent after migration")
	require.NoError(t, db.NewRaw(
		"SELECT user_agent FROM game_sessions WHERE id = ?",
		"00000000-0000-4000-8000-0000000000cc",
	).Scan(ctx, &userAgent))
	assert.Empty(t, userAgent, "the retained default fills user_agent for an old writer")

	_, err = targetMigrator.Rollback(ctx)
	require.NoError(t, err, "roll the user_agent migration back")
	assert.False(t, columnExists(t, db, "user_agent"))
}

func TestGameSessionCheckCountsMigration_DefaultsConstraintsAndRollback(t *testing.T) {
	db := scratchDB(t)
	ctx := context.Background()

	before := migrate.NewMigrations()
	withTarget := migrate.NewMigrations()
	var found bool
	for _, m := range migrations.Migrations.Sorted() {
		withTarget.Add(m)
		if m.Name == "20260622000002" {
			found = true
			break
		}
		before.Add(m)
	}
	require.True(t, found, "the check-count migration must be registered")

	beforeMigrator := migrate.NewMigrator(db, before, migrate.WithMarkAppliedOnSuccess(true))
	require.NoError(t, beforeMigrator.Init(ctx))
	_, err := beforeMigrator.Migrate(ctx)
	require.NoError(t, err, "apply migrations before check counts")
	require.False(t, columnExists(t, db, "square_checks"))

	_, err = db.ExecContext(ctx, `
		INSERT INTO game_sessions (
			id, puzzle_id, ip_address, difficulty, elapsed_ms, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, now(), now())
	`,
		"00000000-0000-4000-8000-0000000000dd",
		"wedding-mini-v1",
		"203.0.113.7",
		"easy",
		5000,
	)
	require.NoError(t, err)

	targetMigrator := migrate.NewMigrator(db, withTarget, migrate.WithMarkAppliedOnSuccess(true))
	require.NoError(t, targetMigrator.Init(ctx))
	_, err = targetMigrator.Migrate(ctx)
	require.NoError(t, err, "apply check-count migration")
	for _, column := range []string{"square_checks", "word_checks", "grid_checks"} {
		assert.True(t, columnExists(t, db, column), "%s is added", column)
	}

	var square, word, grid int64
	require.NoError(t, db.NewRaw(`
		SELECT square_checks, word_checks, grid_checks
		FROM game_sessions WHERE id = ?
	`, "00000000-0000-4000-8000-0000000000dd").Scan(ctx, &square, &word, &grid))
	assert.Zero(t, square)
	assert.Zero(t, word)
	assert.Zero(t, grid)

	// Older writers can omit all three columns during a rolling deployment.
	_, err = db.ExecContext(ctx, `
		INSERT INTO game_sessions (
			id, puzzle_id, ip_address, difficulty, elapsed_ms, created_at, updated_at
		) VALUES (?, ?, ?, ?, ?, now(), now())
	`,
		"00000000-0000-4000-8000-0000000000ee",
		"wedding-mini-v1",
		"203.0.113.8",
		"medium",
		7000,
	)
	require.NoError(t, err, "an old writer can omit check counts")

	for _, column := range []string{"square_checks", "word_checks", "grid_checks"} {
		_, err = db.ExecContext(ctx, fmt.Sprintf(
			`UPDATE game_sessions SET %s = -1 WHERE id = ?`, column,
		), "00000000-0000-4000-8000-0000000000ee")
		require.Error(t, err, "%s rejects a negative total", column)
	}

	_, err = targetMigrator.Rollback(ctx)
	require.NoError(t, err, "roll the check-count migration back")
	for _, column := range []string{"square_checks", "word_checks", "grid_checks"} {
		assert.False(t, columnExists(t, db, column), "%s is dropped", column)
	}
}

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
	require.False(t, columnExists(t, db, "on_leaderboard"), "precondition: the column does not exist yet")

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
	assert.True(t, columnExists(t, db, "on_leaderboard"), "the column is added")

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
	assert.False(t, columnExists(t, db, "on_leaderboard"), "the down drops the column")
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
func columnExists(t *testing.T, db *bun.DB, column string) bool {
	t.Helper()
	var exists bool
	err := db.NewRaw(
		"SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'game_sessions' AND column_name = ?)",
		column,
	).Scan(context.Background(), &exists)
	require.NoError(t, err)
	return exists
}
