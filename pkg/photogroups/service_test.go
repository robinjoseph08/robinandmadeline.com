package photogroups_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/photogroups"
	"github.com/stretchr/testify/require"
)

// newServices returns a photogroups.Service plus the parties service the
// tests build guest fixtures through, backed by a dedicated Postgres test
// database. Truncating parties and photo_groups cascades to guests and
// photo_group_assignments, so each test starts clean. The database is this
// package's own (NewIsolated) rather than the shared one: these tests
// truncate parties, which the concurrently running pkg/parties binary owns
// elsewhere. Tests using it must not call t.Parallel() because the package
// shares this one database and relies on truncation for isolation.
func newServices(t *testing.T) (*photogroups.Service, *parties.Service) {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_photogroups_test")
	databasetest.Truncate(t, db, "parties", "photo_groups")
	return photogroups.NewService(db), parties.NewService(db)
}

// ctx returns a background context for service calls in tests.
func ctx() context.Context { return context.Background() }

// createPartyT creates a party fixture via the parties service.
func createPartyT(t *testing.T, svc *parties.Service, name string) *models.Party {
	t.Helper()
	p, err := svc.CreateParty(ctx(), parties.CreatePartyPayload{
		Name:           name,
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		InvitationType: models.InvitationDigital,
	})
	require.NoError(t, err)
	return p
}

// addGuestT adds a guest fixture to a party via the parties service.
func addGuestT(t *testing.T, svc *parties.Service, partyID, name string) *models.Guest {
	t.Helper()
	g, err := svc.CreateGuest(ctx(), partyID, parties.CreateGuestPayload{FullName: name})
	require.NoError(t, err)
	return g
}

// createGroupT creates a photo group via the service and fails the test on
// error.
func createGroupT(t *testing.T, svc *photogroups.Service, name string) *models.PhotoGroup {
	t.Helper()
	g, err := svc.CreatePhotoGroup(ctx(), photogroups.CreatePhotoGroupPayload{Name: name})
	require.NoError(t, err)
	return g
}

// assignGuestT adds a guest to a photo group via the service.
func assignGuestT(t *testing.T, svc *photogroups.Service, groupID, guestID string) {
	t.Helper()
	_, err := svc.AddGuest(ctx(), groupID, photogroups.AddPhotoGroupGuestPayload{GuestID: guestID})
	require.NoError(t, err)
}
