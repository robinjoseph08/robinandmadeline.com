package databasetest_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/database/databasetest"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestNew_ProvisionsAndMigratesTestDatabase is a smoke test proving the harness
// connects to (auto-creating if needed) the test database and applies the
// migrations: the parties table exists and is queryable after New.
func TestNew_ProvisionsAndMigratesTestDatabase(t *testing.T) {
	db := databasetest.New(t)
	t.Cleanup(func() { databasetest.Truncate(t, db, "parties") })

	var count int
	err := db.NewRaw("SELECT count(*) FROM parties").Scan(context.Background(), &count)
	require.NoError(t, err)
	assert.GreaterOrEqual(t, count, 0)
}
