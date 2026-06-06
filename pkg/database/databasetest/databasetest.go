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
// up/down round-trip). The migrator itself is idempotent, so a concurrent New
// in another package cannot disturb an in-flight test.
package databasetest

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

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
	_, err := migrations.BringUpToDate(ctx, db)
	require.NoError(t, err, "bring test database up to date")

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

// ensureDatabase creates the test database if it is absent. It connects to the
// maintenance "postgres" database on the same server, checks pg_database, and
// issues CREATE DATABASE when needed. A concurrent "already exists" race is
// treated as success so parallel test binaries do not flake.
func ensureDatabase(t *testing.T) error {
	t.Helper()

	dbName, adminDSN, err := maintenanceDSN(testDatabaseURL())
	if err != nil {
		return err
	}

	adminDB := open(t, adminDSN)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	var exists bool
	err = adminDB.NewRaw("SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ?)", dbName).Scan(ctx, &exists)
	if err != nil {
		return fmt.Errorf("check pg_database for %q: %w", dbName, err)
	}
	if exists {
		return nil
	}

	// The database name is derived from our own DSN, not user input, so the
	// identifier interpolation here is safe. CREATE DATABASE cannot be
	// parameterized, hence the formatted statement.
	_, err = adminDB.ExecContext(ctx, fmt.Sprintf(`CREATE DATABASE %q`, dbName))
	if err != nil && !strings.Contains(err.Error(), "already exists") {
		return fmt.Errorf("create database %q: %w", dbName, err)
	}
	return nil
}

// maintenanceDSN parses the test DSN and returns the target database name plus
// a DSN pointing at the maintenance "postgres" database on the same server
// (same credentials/host/params), used to create the test database.
func maintenanceDSN(testDSN string) (dbName, adminDSN string, err error) {
	u, err := url.Parse(testDSN)
	if err != nil {
		return "", "", fmt.Errorf("parse test DSN: %w", err)
	}
	dbName = strings.TrimPrefix(u.Path, "/")
	if dbName == "" {
		return "", "", fmt.Errorf("test DSN has no database name: %q", testDSN)
	}
	admin := *u
	admin.Path = "/postgres"
	return dbName, admin.String(), nil
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
