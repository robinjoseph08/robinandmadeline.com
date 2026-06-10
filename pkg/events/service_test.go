package events_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// newServices returns an events.Service and a parties.Service (for guest
// fixtures) backed by a dedicated Postgres test database, truncating events
// and parties (and via cascade, event_rsvps and guests) before the test runs
// so each test starts clean. The database is this package's own (NewIsolated)
// rather than the shared one: these tests truncate and write parties, which
// the concurrently running pkg/parties binary owns in the shared database, and
// two binaries truncating the same table wipe each other's fixtures mid-test.
// Tests using it must not call t.Parallel() because the package shares this
// one database and relies on truncation for isolation.
func newServices(t *testing.T) (*events.Service, *parties.Service, *bun.DB) {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_events_test")
	databasetest.Truncate(t, db, "events", "parties")
	return events.NewService(db), parties.NewService(db), db
}

// ctx returns a background context for service calls in tests.
func ctx() context.Context { return context.Background() }

// assertErrCode asserts that err resolves to an *errcodes.Error with the given
// code.
func assertErrCode(t *testing.T, err error, code errcodes.Code) {
	t.Helper()
	require.Error(t, err)
	var e *errcodes.Error
	require.ErrorAs(t, err, &e)
	require.Equal(t, string(code), e.Code)
}

// publicEventInput is a minimal valid input for a public event. Callers
// override fields as needed.
func publicEventInput() events.CreateEventPayload {
	return events.CreateEventPayload{
		Name:     "Reception",
		Date:     "2026-10-17",
		IsPublic: true,
	}
}

// privateEventInput is a minimal valid input for a private event.
func privateEventInput() events.CreateEventPayload {
	return events.CreateEventPayload{
		Name:     "Rehearsal Dinner",
		Date:     "2026-10-16",
		IsPublic: false,
	}
}

// createEventT creates an event via the service and fails the test on error.
func createEventT(t *testing.T, svc *events.Service, in events.CreateEventPayload) *models.Event {
	t.Helper()
	e, err := svc.CreateEvent(ctx(), in)
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

// rsvpsForEvent reads every event_rsvps row for an event straight from the DB,
// keyed by guest id, so assertions reflect persisted state.
func rsvpsForEvent(t *testing.T, db *bun.DB, eventID string) map[string]*models.EventRSVP {
	t.Helper()
	var rows []*models.EventRSVP
	err := db.NewSelect().Model(&rows).Where("event_id = ?", eventID).Scan(ctx())
	require.NoError(t, err)
	byGuest := make(map[string]*models.EventRSVP, len(rows))
	for _, r := range rows {
		byGuest[r.GuestID] = r
	}
	return byGuest
}
