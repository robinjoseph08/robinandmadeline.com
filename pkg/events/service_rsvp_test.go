package events_test

import (
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestInviteParties_CreatesPendingRowsForAllPartyGuests(t *testing.T) {
	svc, partySvc, db := newServices(t)

	invited := createPartyT(t, partySvc, "The Smiths")
	g1 := addGuestT(t, partySvc, invited.ID, "Alice")
	g2 := addGuestT(t, partySvc, invited.ID, "Bob")
	other := createPartyT(t, partySvc, "The Joneses")
	addGuestT(t, partySvc, other.ID, "Carol")

	event := createEventT(t, svc, privateEventInput())

	_, err := svc.InviteParties(ctx(), event.ID, events.InvitePartiesPayload{PartyIDs: []string{invited.ID}})
	require.NoError(t, err)

	rows := rsvpsForEvent(t, db, event.ID)
	require.Len(t, rows, 2, "every guest in the invited party gets a row; the other party gets none")
	for _, id := range []string{g1.ID, g2.ID} {
		require.Contains(t, rows, id)
		assert.Equal(t, models.RSVPPending, rows[id].Status)
		assert.Nil(t, rows[id].RSVPedAt)
	}
}

func TestInviteParties_IsIdempotentAndKeepsResponses(t *testing.T) {
	svc, partySvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createEventT(t, svc, privateEventInput())

	_, err := svc.InviteParties(ctx(), event.ID, events.InvitePartiesPayload{PartyIDs: []string{p.ID}})
	require.NoError(t, err)

	// The guest responds; a re-invite must not reset their answer to pending.
	_, err = svc.UpdateRSVPStatus(ctx(), event.ID, g.ID, events.UpdateEventRSVPPayload{Status: models.RSVPAttending})
	require.NoError(t, err)

	_, err = svc.InviteParties(ctx(), event.ID, events.InvitePartiesPayload{PartyIDs: []string{p.ID}})
	require.NoError(t, err)

	rows := rsvpsForEvent(t, db, event.ID)
	require.Len(t, rows, 1)
	assert.Equal(t, models.RSVPAttending, rows[g.ID].Status, "re-inviting never disturbs an existing response")
}

func TestInviteParties_PublicEventRejected(t *testing.T) {
	svc, partySvc, _ := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")
	event := createEventT(t, svc, publicEventInput())

	_, err := svc.InviteParties(ctx(), event.ID, events.InvitePartiesPayload{PartyIDs: []string{p.ID}})
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestInviteParties_MissingEventIs404(t *testing.T) {
	svc, partySvc, _ := newServices(t)
	p := createPartyT(t, partySvc, "The Smiths")

	_, err := svc.InviteParties(ctx(), "00000000-0000-0000-0000-000000000000", events.InvitePartiesPayload{PartyIDs: []string{p.ID}})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestInviteParties_UnknownPartyRejectedAndNothingInvited(t *testing.T) {
	svc, partySvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")
	event := createEventT(t, svc, privateEventInput())

	// One real party plus one unknown id: the whole invite is refused and no
	// rows appear (the check and the insert share a transaction).
	_, err := svc.InviteParties(ctx(), event.ID, events.InvitePartiesPayload{
		PartyIDs: []string{p.ID, "00000000-0000-0000-0000-000000000000"},
	})
	assertErrCode(t, err, errcodes.CodeValidationError)
	assert.Empty(t, rsvpsForEvent(t, db, event.ID))
}

func TestListEventRSVPs_CarriesGuestAndParty(t *testing.T) {
	svc, partySvc, _ := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createEventT(t, svc, publicEventInput())

	rows, total, err := svc.ListEventRSVPs(ctx(), event.ID)
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	require.Len(t, rows, 1)
	require.NotNil(t, rows[0].Guest, "the guest relation is loaded for the response")
	assert.Equal(t, g.ID, rows[0].Guest.ID)
	assert.Equal(t, "Alice", rows[0].Guest.FullName)
	require.NotNil(t, rows[0].Guest.Party, "the guest's party is loaded for the response")
	assert.Equal(t, "The Smiths", rows[0].Guest.Party.Name)
}

func TestListEventRSVPs_MissingEventIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	_, _, err := svc.ListEventRSVPs(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUpdateRSVPStatus_SetsStatusAndRSVPedAtForOneRowOnly(t *testing.T) {
	svc, partySvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g1 := addGuestT(t, partySvc, p.ID, "Alice")
	g2 := addGuestT(t, partySvc, p.ID, "Bob")
	event := createEventT(t, svc, publicEventInput())

	updated, err := svc.UpdateRSVPStatus(ctx(), event.ID, g1.ID, events.UpdateEventRSVPPayload{Status: models.RSVPAttending})
	require.NoError(t, err)
	assert.Equal(t, models.RSVPAttending, updated.Status)
	require.NotNil(t, updated.RSVPedAt, "a response stamps rsvped_at")

	rows := rsvpsForEvent(t, db, event.ID)
	assert.Equal(t, models.RSVPAttending, rows[g1.ID].Status)
	require.NotNil(t, rows[g1.ID].RSVPedAt)
	// The override touches exactly one row: the other guest stays pending.
	assert.Equal(t, models.RSVPPending, rows[g2.ID].Status)
	assert.Nil(t, rows[g2.ID].RSVPedAt)
}

func TestUpdateRSVPStatus_BackToPendingClearsRSVPedAt(t *testing.T) {
	svc, partySvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createEventT(t, svc, publicEventInput())

	_, err := svc.UpdateRSVPStatus(ctx(), event.ID, g.ID, events.UpdateEventRSVPPayload{Status: models.RSVPNotAttending})
	require.NoError(t, err)

	updated, err := svc.UpdateRSVPStatus(ctx(), event.ID, g.ID, events.UpdateEventRSVPPayload{Status: models.RSVPPending})
	require.NoError(t, err)
	assert.Equal(t, models.RSVPPending, updated.Status)
	assert.Nil(t, updated.RSVPedAt, "resetting to pending clears the response timestamp")

	rows := rsvpsForEvent(t, db, event.ID)
	assert.Nil(t, rows[g.ID].RSVPedAt)
}

func TestUpdateRSVPStatus_UninvitedGuestIs404(t *testing.T) {
	svc, partySvc, _ := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createEventT(t, svc, privateEventInput())

	// The guest exists but holds no row for this private event: there is no
	// invitation to override.
	_, err := svc.UpdateRSVPStatus(ctx(), event.ID, g.ID, events.UpdateEventRSVPPayload{Status: models.RSVPAttending})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestRSVPBreakdowns_CountsByStatus(t *testing.T) {
	svc, partySvc, _ := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g1 := addGuestT(t, partySvc, p.ID, "Alice")
	g2 := addGuestT(t, partySvc, p.ID, "Bob")
	addGuestT(t, partySvc, p.ID, "Carol")
	event := createEventT(t, svc, publicEventInput())
	empty := createEventT(t, svc, privateEventInput())

	_, err := svc.UpdateRSVPStatus(ctx(), event.ID, g1.ID, events.UpdateEventRSVPPayload{Status: models.RSVPAttending})
	require.NoError(t, err)
	_, err = svc.UpdateRSVPStatus(ctx(), event.ID, g2.ID, events.UpdateEventRSVPPayload{Status: models.RSVPNotAttending})
	require.NoError(t, err)

	breakdowns, err := svc.RSVPBreakdowns(ctx(), []string{event.ID, empty.ID})
	require.NoError(t, err)
	assert.Equal(t, events.RSVPBreakdown{Pending: 1, Attending: 1, NotAttending: 1, Total: 3}, breakdowns[event.ID])
	assert.Equal(t, events.RSVPBreakdown{}, breakdowns[empty.ID], "an event with no rows reads as all zeros")
}
