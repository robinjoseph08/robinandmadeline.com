package events_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// These tests cover the third auto-creation path of ADR 0002: a new guest is
// born already invited (pending) to every public event. The behavior lives in
// the guest-create paths of pkg/parties, which call this package's
// BackfillPublicEventRSVPs inside their own transactions; the tests drive
// those public entry points.

func TestCreateGuest_BackfillsPendingRSVPsForPublicEvents(t *testing.T) {
	svc, partySvc, db := newServices(t)

	public := createEventT(t, svc, publicEventInput())
	private := createEventT(t, svc, privateEventInput())

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")

	publicRows := rsvpsForEvent(t, db, public.ID)
	require.Len(t, publicRows, 1, "the new guest is invited to the public event")
	assert.Equal(t, models.RSVPPending, publicRows[g.ID].Status)
	assert.Nil(t, publicRows[g.ID].RSVPedAt)

	assert.Empty(t, rsvpsForEvent(t, db, private.ID), "a new guest is never auto-invited to a private event")
}

func TestCreatePartyWithGuest_BackfillsFirstGuestForPublicEvents(t *testing.T) {
	svc, partySvc, db := newServices(t)

	public := createEventT(t, svc, publicEventInput())

	created, err := partySvc.CreatePartyWithGuest(ctx(), parties.CreatePartyWithGuestPayload{
		Name:           "The Joneses",
		Side:           models.SideMadeline,
		Relation:       models.RelationFamily,
		InvitationType: models.InvitationDigital,
		Guest:          parties.FirstGuestPayload{FullName: "Carol"},
	})
	require.NoError(t, err)
	require.Len(t, created.Guests, 1)

	rows := rsvpsForEvent(t, db, public.ID)
	require.Len(t, rows, 1, "the party's first guest is invited to the public event")
	assert.Equal(t, models.RSVPPending, rows[created.Guests[0].ID].Status)
}

func TestCreateGuest_BackfillLeavesOtherGuestsRowsUntouched(t *testing.T) {
	svc, partySvc, db := newServices(t)

	public := createEventT(t, svc, publicEventInput())
	p := createPartyT(t, partySvc, "The Smiths")
	first := addGuestT(t, partySvc, p.ID, "Alice")

	// The first guest responds before the second guest exists.
	_, err := svc.UpdateRSVPStatus(ctx(), public.ID, first.ID, events.UpdateEventRSVPPayload{Status: models.RSVPAttending})
	require.NoError(t, err)

	second := addGuestT(t, partySvc, p.ID, "Bob")

	rows := rsvpsForEvent(t, db, public.ID)
	require.Len(t, rows, 2)
	assert.Equal(t, models.RSVPAttending, rows[first.ID].Status, "an existing response survives a sibling's backfill")
	assert.Equal(t, models.RSVPPending, rows[second.ID].Status)
}

// blockPendingInserts injects a fault for the transactionality tests: a CHECK
// constraint that rejects pending event_rsvps inserts, making any auto-creation
// backfill fail. The constraint is dropped on cleanup. This package owns its
// isolated test database, so the temporary DDL cannot affect other packages.
func blockPendingInserts(t *testing.T, db *bun.DB) {
	t.Helper()
	_, err := db.ExecContext(ctx(), `ALTER TABLE event_rsvps ADD CONSTRAINT test_no_pending CHECK (status <> 'pending')`)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, err := db.ExecContext(context.Background(), `ALTER TABLE event_rsvps DROP CONSTRAINT IF EXISTS test_no_pending`)
		require.NoError(t, err)
	})
}

func TestCreateEvent_FailedBackfillRollsBackTheEvent(t *testing.T) {
	svc, partySvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")
	blockPendingInserts(t, db)

	// The event insert succeeds but the public backfill cannot: the whole
	// create must roll back, leaving no half-created public event whose
	// invited set is missing (ADR 0002).
	_, err := svc.CreateEvent(ctx(), publicEventInput())
	require.Error(t, err)

	count, err := db.NewSelect().Model((*models.Event)(nil)).Count(ctx())
	require.NoError(t, err)
	assert.Zero(t, count, "the failed backfill rolled the event back too")
}

func TestCreateGuest_FailedBackfillRollsBackTheGuest(t *testing.T) {
	svc, partySvc, db := newServices(t)

	createEventT(t, svc, publicEventInput())
	p := createPartyT(t, partySvc, "The Smiths")
	blockPendingInserts(t, db)

	// The guest insert succeeds but its public-event backfill cannot: the
	// whole create must roll back, leaving no guest missing from a public
	// event's invited set (ADR 0002).
	_, err := partySvc.CreateGuest(ctx(), p.ID, parties.CreateGuestPayload{FullName: "Alice"})
	require.Error(t, err)

	count, err := db.NewSelect().Model((*models.Guest)(nil)).Count(ctx())
	require.NoError(t, err)
	assert.Zero(t, count, "the failed backfill rolled the guest back too")
}
