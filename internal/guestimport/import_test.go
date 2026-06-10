package guestimport_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/internal/guestimport"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// newDB returns the shared Postgres test database, truncated so each test
// starts clean. Tests using it must not call t.Parallel() (see databasetest).
func newDB(t *testing.T) *bun.DB {
	t.Helper()
	db := databasetest.New(t)
	databasetest.Truncate(t, db, "parties")
	return db
}

func ctx() context.Context { return context.Background() }

// seedParty inserts a minimal pre-existing party directly, to simulate a
// database that already holds data before an import runs.
func seedParty(t *testing.T, db *bun.DB, name string) {
	t.Helper()
	party := &models.Party{
		ID:             "0197fc00-0000-7000-8000-000000000001",
		Name:           name,
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		Circle:         []string{},
		InvitationType: models.InvitationDigital,
		InfoToken:      "seed-token",
	}
	_, err := db.NewInsert().Model(party).Exec(ctx())
	require.NoError(t, err)
}

// loadParties fetches all parties with their guests in creation order.
func loadParties(t *testing.T, db *bun.DB) []*models.Party {
	t.Helper()
	var parties []*models.Party
	err := db.NewSelect().Model(&parties).
		Relation("Guests", func(q *bun.SelectQuery) *bun.SelectQuery {
			return q.Order("g.created_at ASC", "g.id ASC")
		}).
		Order("p.created_at ASC", "p.id ASC").Scan(ctx())
	require.NoError(t, err)
	return parties
}

func TestImport_CreatesPartiesAndGuestsInOneTransaction(t *testing.T) {
	db := newDB(t)
	plan := parseT(t,
		`Alice,Adams,Alice Adams,Robin,Family,Immediate,"Sibling, Bridal Party",Adams,2,555-0100,alice@example.com,123 Main St,Springfield,No,Yes,Ms.,KALEL,,`,
		`Bob,Adams,Bob Adams,Robin,Family,Immediate,In-Law,Adams,2,,,,,Yes,No,Mr.,KALEL,,`,
		`Cara,Brown,Cara Brown,Madeline,Friend,College,UIUC,Brown,1,,,,,No,Yes,,,,`,
	)

	summary, err := guestimport.Import(ctx(), db, plan, guestimport.Options{})
	require.NoError(t, err)
	require.Equal(t, 2, summary.PartiesCreated)
	require.Equal(t, 3, summary.GuestsCreated)

	parties := loadParties(t, db)
	require.Len(t, parties, 2)

	adams, brown := parties[0], parties[1]
	require.Equal(t, "Adams", adams.Name)
	require.Equal(t, models.SideRobin, adams.Side)
	require.Equal(t, models.RelationFamily, adams.Relation)
	require.Equal(t, []string{models.CircleImmediate}, adams.Circle)
	require.Equal(t, models.InvitationPhysical, adams.InvitationType)
	require.NotNil(t, adams.RSVPCode)
	require.Equal(t, "KALEL", *adams.RSVPCode, "an explicit code is preserved")
	require.False(t, adams.InfoCollectionRequested, "imported parties start not-requested (ADR 0005)")
	require.False(t, adams.InfoCollectionConfirmed)
	require.NotEmpty(t, adams.InfoToken)

	require.NotNil(t, brown.RSVPCode, "a blank code is auto-generated")
	require.Regexp(t, `^[BCDFGHJKLMNPQRSTVWXZ]{5}$`, *brown.RSVPCode)
	require.NotEmpty(t, brown.InfoToken)
	require.NotEqual(t, adams.InfoToken, brown.InfoToken)

	require.Len(t, adams.Guests, 2)
	alice, bob := adams.Guests[0], adams.Guests[1]
	require.Equal(t, "Alice Adams", alice.FullName)
	require.True(t, alice.IsPrimary)
	require.Equal(t, []string{"Sibling", "Bridal Party"}, alice.Tags)
	require.Equal(t, pointerutil.String("alice@example.com"), alice.Email)
	require.Equal(t, pointerutil.String("555-0100"), alice.Phone)
	require.True(t, alice.IsDrinking)
	require.False(t, bob.IsPrimary)
	require.True(t, bob.IsChild)
	require.False(t, bob.IsDrinking)
	require.Nil(t, bob.Email)

	require.Len(t, brown.Guests, 1)
	require.True(t, brown.Guests[0].IsPrimary, "exactly one primary per party")

	// The sheet has no state/postal/country columns, so even a party imported
	// with an address line and city lacks required fields and its status
	// derives incomplete (ADR 0005); both imported parties read incomplete.
	require.Equal(t, models.StatusIncomplete, adams.InfoCollectionStatus())
	require.Equal(t, models.StatusIncomplete, brown.InfoCollectionStatus())
}

func TestImport_FailsCleanlyWhenPartiesAlreadyExist(t *testing.T) {
	db := newDB(t)
	seedParty(t, db, "Existing")
	plan := parseT(t,
		`Cara,Brown,Cara Brown,Madeline,Friend,College,UIUC,Brown,1,,,,,No,Yes,,,,`,
	)

	_, err := guestimport.Import(ctx(), db, plan, guestimport.Options{})
	require.Error(t, err)
	require.Contains(t, err.Error(), "already contains 1 parties")
	require.Contains(t, err.Error(), "--truncate")

	parties := loadParties(t, db)
	require.Len(t, parties, 1, "nothing was imported")
	require.Equal(t, "Existing", parties[0].Name)
}

func TestImport_TruncateWipesExistingDataFirst(t *testing.T) {
	db := newDB(t)
	seedParty(t, db, "Stale")
	plan := parseT(t,
		`Cara,Brown,Cara Brown,Madeline,Friend,College,UIUC,Brown,1,,,,,No,Yes,,,,`,
	)

	summary, err := guestimport.Import(ctx(), db, plan, guestimport.Options{Truncate: true})
	require.NoError(t, err)
	require.Equal(t, 1, summary.PartiesCreated)

	parties := loadParties(t, db)
	require.Len(t, parties, 1)
	require.Equal(t, "Brown", parties[0].Name)
}

func TestImport_RollsBackEverythingWhenAnInsertFails(t *testing.T) {
	db := newDB(t)
	// A hand-built plan whose party row is valid but whose guests violate the
	// one-primary-per-party index, so the parties insert succeeds and the
	// guests insert fails: the party must roll back with it.
	plan := &guestimport.Plan{Parties: []*guestimport.PartyPlan{{
		Party: &models.Party{
			Name:           "Broken",
			Side:           models.SideRobin,
			Relation:       models.RelationFriend,
			Circle:         []string{},
			InvitationType: models.InvitationPhysical,
		},
		Guests: []*models.Guest{
			{FullName: "First Primary", IsPrimary: true, Tags: []string{}},
			{FullName: "Second Primary", IsPrimary: true, Tags: []string{}},
		},
	}}}

	_, err := guestimport.Import(ctx(), db, plan, guestimport.Options{})
	require.Error(t, err)
	require.Empty(t, loadParties(t, db), "the whole import rolled back")
}

func TestImport_EmptyPlanImportsNothing(t *testing.T) {
	db := newDB(t)
	plan := parseT(t, `,,,,,,,,,,,,,,,,,,`)

	summary, err := guestimport.Import(ctx(), db, plan, guestimport.Options{})
	require.NoError(t, err)
	require.Zero(t, summary.PartiesCreated)
	require.Zero(t, summary.GuestsCreated)
	require.Empty(t, loadParties(t, db))
}
