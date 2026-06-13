package database_test

import (
	"context"
	"database/sql"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/worktree"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/dialect/pgdialect"
	"github.com/uptrace/bun/driver/pgdriver"
)

// throwawayDSN points at a uniquely named, disposable database on the same
// Postgres as the test harness (honoring TEST_DATABASE_URL for host/creds in
// CI), scoped per worktree so concurrent worktrees never create/drop the same
// name out from under each other.
func throwawayDSN(t *testing.T) string {
	t.Helper()
	base := "postgres://robinandmadeline_admin:password@localhost:5432/placeholder?sslmode=disable"
	if v := os.Getenv("TEST_DATABASE_URL"); v != "" {
		base = v
	}
	u, err := url.Parse(base)
	require.NoError(t, err)
	u.Path = "/" + worktree.ScopedName("ram_dropif_test")
	return u.String()
}

// databaseExists reports whether the database named in dsn currently exists,
// queried through the maintenance database so it works whether or not the target
// is present.
func databaseExists(t *testing.T, dsn string) bool {
	t.Helper()
	u, err := url.Parse(dsn)
	require.NoError(t, err)
	name := strings.TrimPrefix(u.Path, "/")
	admin := *u
	admin.Path = "/postgres"

	db := bun.NewDB(
		sql.OpenDB(pgdriver.NewConnector(pgdriver.WithDSN(admin.String()))),
		pgdialect.New(),
	)
	defer func() { _ = db.Close() }()

	var exists bool
	require.NoError(t, db.NewRaw(
		"SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ?)", name,
	).Scan(context.Background(), &exists))
	return exists
}

func TestDropIfExists(t *testing.T) {
	ctx := context.Background()
	dsn := throwawayDSN(t)

	// Start from a known-absent state in case a prior aborted run leaked it.
	require.NoError(t, database.DropIfExists(ctx, dsn))

	require.NoError(t, database.EnsureExists(ctx, dsn))
	assert.True(t, databaseExists(t, dsn), "database should exist after EnsureExists")

	require.NoError(t, database.DropIfExists(ctx, dsn))
	assert.False(t, databaseExists(t, dsn), "database should be gone after DropIfExists")

	// Idempotent: dropping an absent database is a no-op, not an error.
	require.NoError(t, database.DropIfExists(ctx, dsn))
}
