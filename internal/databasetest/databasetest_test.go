package databasetest_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNew_ProvisionsAndMigratesTestDatabase is a smoke test proving the harness
// connects to (auto-creating if needed) the test database and applies the
// migrations: the parties table exists and is queryable after New.
//
// It deliberately only reads (the count >= 0 assertion holds regardless of any
// rows) and does not truncate, so it is safe to run concurrently with other
// packages that share this database (go test runs package binaries in
// parallel). New serializes provisioning under an advisory lock, so this call
// cannot race another package's migrate either.
func TestNew_ProvisionsAndMigratesTestDatabase(t *testing.T) {
	db := databasetest.New(t)

	var count int
	err := db.NewRaw("SELECT count(*) FROM parties").Scan(context.Background(), &count)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, count, 0)
}
