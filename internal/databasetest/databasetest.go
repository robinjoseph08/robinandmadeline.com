// Package databasetest provides a shared Postgres test harness for packages
// that exercise real SQL (text[], CHECK constraints, UUIDs, partial indexes)
// which an in-memory engine cannot reproduce.
//
// It targets a dedicated test database, never the dev database. The harness
// connects to the maintenance "postgres" database, creates the test database if
// it does not already exist, then connects to it and brings it up to date with
// the registered migrations. Tests get isolation by truncating the touched
// tables between runs.
//
// The default DSN matches the docker-compose Postgres credentials but points at
// a "_test" database; override the whole DSN with TEST_DATABASE_URL (used in
// CI).
//
// Concurrency: every test in one package binary that touches the shared tables
// must run serially (no t.Parallel), since truncation is not safe to run
// concurrently against shared tables. Across package binaries, which `go test`
// runs in parallel, a test must not make order-sensitive assertions against the
// shared database unless it either only reads / runs idempotent statements or
// uses its own dedicated database (as pkg/migrations does for its destructive
// up/down round-trip). Provisioning itself is concurrency-safe: EnsureExists
// treats losing the create-database race as success, and New serializes
// migration under a Postgres advisory lock, since bun's Migrator.Migrate takes
// no lock of its own and two binaries migrating a fresh database would race.
package databasetest

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/migrations"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

// defaultTestDatabaseURL points at a dedicated test database using the same
// credentials/host as the docker-compose default. It is intentionally a
// different database name from the dev default so tests can never truncate or
// migrate development data.
const defaultTestDatabaseURL = "postgres://robinandmadeline_admin:password@localhost:5432/robinandmadeline_test?sslmode=disable" //nolint:gosec // local/CI test default, overridden via TEST_DATABASE_URL

// testDatabaseURL returns the DSN for the test database, honoring the
// TEST_DATABASE_URL override (set in CI) and falling back to the local default.
func testDatabaseURL() string {
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		return v
	}
	return defaultTestDatabaseURL
}

// migrateLockID is the advisory lock key under which New runs the migrator.
// The value is arbitrary; it only has to be the same for every harness user so
// they serialize against each other.
const migrateLockID = 824873

// New returns a Bun DB connected to the (auto-provisioned, migrated) test
// database. The connection is closed automatically via t.Cleanup.
//
// On first use it ensures the test database exists and is migrated; subsequent
// calls reconnect to the already-prepared database. Any failure fails the test
// immediately, since a test that cannot reach its database has nothing useful
// to assert.
func New(t *testing.T) *bun.DB {
	t.Helper()

	require.NoError(t, ensureDatabase(t), "ensure test database exists")

	db := open(t, testDatabaseURL())

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// go test runs package binaries in parallel and bun's Migrator.Migrate takes
	// no lock, so on a fresh database two binaries could both try to apply the
	// first migration and one would fail. A session-level advisory lock, held on
	// its own connection for the duration of the migrate, serializes them. The
	// session releases the lock even on a failure path, since closing the
	// connection (deferred, and run before require unwinds the test) ends it.
	conn, err := db.Conn(ctx)
	require.NoError(t, err, "open advisory lock connection")
	defer func() { _ = conn.Close() }()

	_, err = conn.ExecContext(ctx, "SELECT pg_advisory_lock(?)", migrateLockID)
	require.NoError(t, err, "acquire migrate advisory lock")

	_, err = migrations.BringUpToDate(ctx, db)
	require.NoError(t, err, "bring test database up to date")

	_, err = conn.ExecContext(ctx, "SELECT pg_advisory_unlock(?)", migrateLockID)
	require.NoError(t, err, "release migrate advisory lock")

	return db
}

// open dials a DSN and returns a Bun DB that closes on test cleanup.
func open(t *testing.T, dsn string) *bun.DB {
	t.Helper()
	connector := pgdriver.NewConnector(pgdriver.WithDSN(dsn))
	sqldb := sql.OpenDB(connector)
	db := bun.NewDB(sqldb, pgdialect.New())
	t.Cleanup(func() {
		require.NoError(t, db.Close())
	})
	return db
}

// ensureDatabase creates the test database if it is absent, delegating to the
// shared database.EnsureExists so the create-if-missing logic lives in one place
// (the migrations CLI's createdb command and the e2e setup reuse it too).
func ensureDatabase(t *testing.T) error {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	return database.EnsureExists(ctx, testDatabaseURL())
}

// Truncate empties the given tables and is the per-test isolation primitive.
// Call it (typically via t.Cleanup) so each test starts from a clean slate.
// TRUNCATE ... CASCADE also clears dependent rows (e.g. truncating parties
// removes guests via the FK), and RESTART IDENTITY resets any sequences.
func Truncate(t *testing.T, db *bun.DB, tables ...string) {
	t.Helper()
	if len(tables) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	stmt := fmt.Sprintf("TRUNCATE TABLE %s RESTART IDENTITY CASCADE", strings.Join(tables, ", "))
	_, err := db.ExecContext(ctx, stmt)
	require.NoError(t, err, "truncate tables")
}
