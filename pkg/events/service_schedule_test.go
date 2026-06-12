package events_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// eventNames projects a schedule result to its event names, in order.
func eventNames(list []*models.Event) []string {
	names := make([]string, 0, len(list))
	for _, e := range list {
		names = append(names, e.Name)
	}
	return names
}

func TestScheduleEvents_AnonymousListsOnlyPublicEvents(t *testing.T) {
	svc, _, _ := newServices(t)

	createEventT(t, svc, publicEventInput())
	createEventT(t, svc, privateEventInput())

	list, total, err := svc.ScheduleEvents(ctx(), "")
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	assert.Equal(t, []string{"Reception"}, eventNames(list))
}

func TestScheduleEvents_PartyListsPublicAndInvitedPrivateEvents(t *testing.T) {
	svc, partySvc, _ := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")

	createEventT(t, svc, publicEventInput())
	invited := createEventT(t, svc, privateEventInput())
	_, err := svc.InviteParties(ctx(), invited.ID, events.InvitePartiesPayload{PartyIDs: []string{p.ID}})
	require.NoError(t, err)

	// A private event the party was never invited to stays invisible.
	uninvitedInput := privateEventInput()
	uninvitedInput.Name = "Bridal Party Photos"
	createEventT(t, svc, uninvitedInput)

	list, total, err := svc.ScheduleEvents(ctx(), p.ID)
	require.NoError(t, err)
	assert.Equal(t, 2, total)
	// Schedule order: the private Rehearsal Dinner (2026-10-16) precedes the
	// public Reception (2026-10-17).
	assert.Equal(t, []string{"Rehearsal Dinner", "Reception"}, eventNames(list))
}

func TestScheduleEvents_UnknownPartyStillListsPublicEvents(t *testing.T) {
	svc, _, _ := newServices(t)

	createEventT(t, svc, publicEventInput())
	createEventT(t, svc, privateEventInput())

	// A party deleted while a guest token for it was still live: the schedule
	// degrades to the public view rather than erroring or leaking anything.
	list, total, err := svc.ScheduleEvents(ctx(), "0190b8e0-0000-7000-8000-000000000001")
	require.NoError(t, err)
	assert.Equal(t, 1, total)
	assert.Equal(t, []string{"Reception"}, eventNames(list))
}

func TestScheduleEvents_ScheduleOrder(t *testing.T) {
	svc, _, _ := newServices(t)

	// Inserted out of order on purpose: a later-day event first, then the same
	// day's untimed and timed events.
	brunch := publicEventInput()
	brunch.Name = "Brunch"
	brunch.Date = "2026-10-18"
	brunch.StartTime = pointerutil.String("10:00")
	createEventT(t, svc, brunch)

	untimed := publicEventInput()
	untimed.Name = "Welcome Party"
	untimed.Date = "2026-10-17"
	createEventT(t, svc, untimed)

	ceremony := publicEventInput()
	ceremony.Name = "Ceremony"
	ceremony.Date = "2026-10-17"
	ceremony.StartTime = pointerutil.String("16:30")
	createEventT(t, svc, ceremony)

	list, _, err := svc.ScheduleEvents(ctx(), "")
	require.NoError(t, err)
	// Date first, then start_time with untimed events trailing their day.
	assert.Equal(t, []string{"Ceremony", "Welcome Party", "Brunch"}, eventNames(list))
}
