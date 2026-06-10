// Package database wires up the Bun ORM against Postgres.
package database

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"strings"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/config"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

// New opens a Bun DB backed by Postgres using the configured DATABASE_URL.
//
// It does not verify connectivity; call Ping (or rely on the first query) to
// confirm the database is reachable. This keeps startup non-fatal when the DB
// is briefly unavailable.
func New(cfg *config.Config) (*bun.DB, error) {
	connector := pgdriver.NewConnector(pgdriver.WithDSN(cfg.DatabaseURL))
	sqldb := sql.OpenDB(connector)
	db := bun.NewDB(sqldb, pgdialect.New())
	return db, nil
}

// Ping verifies that the database is reachable.
func Ping(ctx context.Context, db *bun.DB) error {
	if err := db.PingContext(ctx); err != nil {
		return fmt.Errorf("database ping failed: %w", err)
	}
	return nil
}

// EnsureExists creates the database named in dsn if it is absent, connecting to
// the maintenance "postgres" database on the same server to do so. It is
// idempotent: an already-present database (or a concurrent create race) is
// treated as success. This bootstraps the test/e2e databases, which are not
// provisioned by docker-compose; the dev and production databases already exist
// (and are migrated via the Fly release_command per ADR 0007).
func EnsureExists(ctx context.Context, dsn string) error {
	dbName, adminDSN, err := maintenanceDSN(dsn)
	if err != nil {
		return err
	}

	adminDB := bun.NewDB(
		sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(adminDSN))),
		pgdialect.New(),
	)
	defer func() { _ = adminDB.Close() }()

	var exists bool
	err = adminDB.NewRaw(
		"SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ?)", dbName,
	).Scan(ctx, &exists)
	if err != nil {
		return fmt.Errorf("check pg_database for %q: %w", dbName, err)
	}
	if exists {
		return nil
	}

	// The database name is derived from our own DSN, not user input, so the
	// identifier interpolation here is safe. CREATE DATABASE cannot be
	// parameterized, hence the formatted statement.
	_, err = adminDB.ExecContext(ctx, fmt.Sprintf("CREATE DATABASE %q", dbName))
	if err != nil && !strings.Contains(err.Error(), "already exists") {
		return fmt.Errorf("create database %q: %w", dbName, err)
	}
	return nil
}

// maintenanceDSN parses dsn and returns the target database name plus a DSN
// pointing at the maintenance "postgres" database on the same server (same
// credentials, host, and params), used to create the target database.
func maintenanceDSN(dsn string) (dbName, adminDSN string, err error) {
	u, err := url.Parse(dsn)
	if err != nil {
		return "", "", fmt.Errorf("parse DSN: %w", err)
	}
	dbName = strings.TrimPrefix(u.Path, "/")
	if dbName == "" {
		return "", "", fmt.Errorf("DSN has no database name: %q", dsn)
	}
	admin := *u
	admin.Path = "/postgres"
	return dbName, admin.String(), nil
}
