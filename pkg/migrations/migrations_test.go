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
