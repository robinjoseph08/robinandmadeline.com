package photogroups_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/photogroups"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// newServices returns a photogroups.Service plus the events and parties
// services the tests build fixtures through, backed by a dedicated Postgres
// test database. Truncating events and parties cascades to photo_groups,
// photo_group_assignments, guests, and event_rsvps, so each test starts clean.
// The database is this package's own (NewIsolated) rather than the shared one:
// these tests truncate events and parties, which the concurrently running
// pkg/events and pkg/parties binaries own elsewhere. Tests using it must not
// call t.Parallel() because the package shares this one database and relies on
// truncation for isolation.
func newServices(t *testing.T) (*photogroups.Service, *events.Service, *parties.Service, *bun.DB) {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_photogroups_test")
	databasetest.Truncate(t, db, "events", "parties")
	return photogroups.NewService(db), events.NewService(db), parties.NewService(db), db
}

// ctx returns a background context for service calls in tests.
func ctx() context.Context { return context.Background() }

// createEventT creates an event fixture via the events service.
func createEventT(t *testing.T, svc *events.Service, name string) *models.Event {
	t.Helper()
	e, err := svc.CreateEvent(ctx(), events.CreateEventPayload{
		Name: name,
		Date: "2026-10-17",
	})
	require.NoError(t, err)
	return e
}

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
func createGroupT(t *testing.T, svc *photogroups.Service, eventID, name string) *models.PhotoGroup {
	t.Helper()
	g, err := svc.CreatePhotoGroup(ctx(), photogroups.CreatePhotoGroupPayload{
		EventID: eventID,
		Name:    name,
	})
	require.NoError(t, err)
	return g
}
