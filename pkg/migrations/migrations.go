// Package migrations holds the Bun SQL migrations and the helpers that run
// them. Each migration registers itself with the package-level Migrations
// registry via an init() function, so importing this package is enough to make
// every migration available to the migrator.
package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
	"github.com/uptrace/bun/migrate"
)

// Migrations is the registry every migration file appends to from its init().
// It is shared by the CLI (cmd/migrations) and the test harness
// (internal/databasetest) so both run the exact same set of migrations; the
// API itself never migrates (ADR 0007).
var Migrations = migrate.NewMigrations()

// NewMigrator builds a Migrator over the package Migrations registry.
//
// WithMarkAppliedOnSuccess(true) means a migration is recorded as applied only
// after its up function returns without error. A migration that fails partway
// is therefore left unapplied, so a fixed-up version can be retried cleanly
// rather than being skipped on the next run.
func NewMigrator(db *bun.DB) *migrate.Migrator {
	return newMigrator(db, Migrations)
}

// newMigrator is the testable core of NewMigrator: it takes the migration set
// explicitly so tests can exercise the migrator against a throwaway registry.
func newMigrator(db *bun.DB, migrations *migrate.Migrations) *migrate.Migrator {
	return migrate.NewMigrator(db, migrations, migrate.WithMarkAppliedOnSuccess(true))
}

// BringUpToDate initializes the migration bookkeeping tables (idempotent) and
// applies every pending migration. The API never migrates at startup (ADR
// 0007): production migrates via the Fly release_command and local dev via
// `mise db:migrate`, both through the CLI's own Init+Migrate calls. This
// helper serves the test harness (internal/databasetest), which provisions the
// test database with it.
func BringUpToDate(ctx context.Context, db *bun.DB) (*migrate.MigrationGroup, error) {
	migrator := NewMigrator(db)
	if err := migrator.Init(ctx); err != nil {
		return nil, fmt.Errorf("init migrator: %w", err)
	}
	group, err := migrator.Migrate(ctx)
	if err != nil {
		return nil, fmt.Errorf("run migrations: %w", err)
	}
	return group, nil
}
