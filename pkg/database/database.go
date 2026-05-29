// Package database wires up the Bun ORM against Postgres.
package database

import (
	"context"
	"database/sql"
	"fmt"

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
