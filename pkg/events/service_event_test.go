package events_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateEvent_PersistsFields(t *testing.T) {
	svc, _, _ := newServices(t)

	created := createEventT(t, svc, events.CreateEventPayload{
		Name:        "Ceremony",
		Description: pointerutil.String("The main event"),
		Location:    pointerutil.String("Garden Pavilion"),
		LocationURL: pointerutil.String("https://maps.app.goo.gl/abc123"),
		Date:        "2026-10-17",
		StartTime:   pointerutil.String("16:00"),
		EndTime:     pointerutil.String("17:00"),
		IsPublic:    true,
	})

	reloaded, err := svc.GetEvent(ctx(), created.ID)
	require.NoError(t, err)
	assert.Equal(t, "Ceremony", reloaded.Name)
	assert.Equal(t, pointerutil.String("The main event"), reloaded.Description)
	assert.Equal(t, pointerutil.String("Garden Pavilion"), reloaded.Location)
	assert.Equal(t, pointerutil.String("https://maps.app.goo.gl/abc123"), reloaded.LocationURL)
	// The DATE column round-trips as the same YYYY-MM-DD string.
	assert.Equal(t, "2026-10-17", reloaded.Date)
	assert.Equal(t, pointerutil.String("16:00"), reloaded.StartTime)
	assert.Equal(t, pointerutil.String("17:00"), reloaded.EndTime)
	assert.True(t, reloaded.IsPublic)
}

func TestCreateEvent_PublicBackfillsPendingRSVPsForAllGuests(t *testing.T) {
	svc, partySvc, db := newServices(t)

	a := createPartyT(t, partySvc, "The Smiths")
	g1 := addGuestT(t, partySvc, a.ID, "Alice")
	g2 := addGuestT(t, partySvc, a.ID, "Bob")
	b := createPartyT(t, partySvc, "The Joneses")
	g3 := addGuestT(t, partySvc, b.ID, "Carol")

	event := createEventT(t, svc, publicEventInput())

	rows := rsvpsForEvent(t, db, event.ID)
	require.Len(t, rows, 3, "every existing guest gets an event_rsvps row")
	for _, id := range []string{g1.ID, g2.ID, g3.ID} {
		row, ok := rows[id]
		require.True(t, ok, "guest %s should have a row", id)
		assert.Equal(t, models.RSVPPending, row.Status)
		assert.Nil(t, row.RSVPedAt, "a pending row has never been responded to")
	}
}

func TestCreateEvent_PrivateCreatesNoRSVPs(t *testing.T) {
	svc, partySvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")

	event := createEventT(t, svc, privateEventInput())

	rows := rsvpsForEvent(t, db, event.ID)
	assert.Empty(t, rows, "a private event invites nobody at creation")
}

func TestGetEvent_MissingIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	_, err := svc.GetEvent(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestListEvents_OrdersByDateThenStartTime(t *testing.T) {
	svc, _, _ := newServices(t)

	reception := publicEventInput()
	reception.Name = "Reception"
	reception.StartTime = pointerutil.String("18:00")
	createEventT(t, svc, reception)

	ceremony := publicEventInput()
	ceremony.Name = "Ceremony"
	ceremony.StartTime = pointerutil.String("16:00")
	createEventT(t, svc, ceremony)

	brunch := publicEventInput()
	brunch.Name = "Brunch"
	createEventT(t, svc, brunch)

	rehearsal := privateEventInput()
	rehearsal.Name = "Rehearsal Dinner"
	rehearsal.Date = "2026-10-16"
	createEventT(t, svc, rehearsal)

	listed, total, err := svc.ListEvents(ctx())
	require.NoError(t, err)
	assert.Equal(t, 4, total)
	names := make([]string, 0, len(listed))
	for _, e := range listed {
		names = append(names, e.Name)
	}
	// Date first, then start_time orders the same-day events chronologically,
	// with the untimed Brunch trailing its day (NULL start_time sorts last).
	assert.Equal(t, []string{"Rehearsal Dinner", "Ceremony", "Reception", "Brunch"}, names)
}

func TestUpdateEvent_AppliesFields(t *testing.T) {
	svc, _, _ := newServices(t)
	created := createEventT(t, svc, privateEventInput())

	updated, err := svc.UpdateEvent(ctx(), created.ID, events.UpdateEventPayload{
		Name:        "Madhuram Veppu",
		Location:    pointerutil.String("Family Home"),
		LocationURL: pointerutil.String("https://maps.app.goo.gl/family"),
		Date:        "2026-10-15",
		StartTime:   pointerutil.String("18:30"),
		IsPublic:    false,
	})
	require.NoError(t, err)
	assert.Equal(t, "Madhuram Veppu", updated.Name)

	reloaded, err := svc.GetEvent(ctx(), created.ID)
	require.NoError(t, err)
	assert.Equal(t, "Madhuram Veppu", reloaded.Name)
	assert.Nil(t, reloaded.Description, "an omitted optional field persists as NULL")
	assert.Equal(t, pointerutil.String("Family Home"), reloaded.Location)
	assert.Equal(t, pointerutil.String("https://maps.app.goo.gl/family"), reloaded.LocationURL)
	assert.Equal(t, "2026-10-15", reloaded.Date)
	assert.Equal(t, pointerutil.String("18:30"), reloaded.StartTime)
	assert.Nil(t, reloaded.EndTime)
}

// A Location Link decorates a Location, so the service rejects a location_url
// with no location on both write paths (the binder validates each field's own
// format; this cross-field rule lives in the service). The rejection is a 422,
// and nothing is persisted.
func TestCreateEvent_RejectsLocationLinkWithoutLocation(t *testing.T) {
	svc, _, _ := newServices(t)

	_, err := svc.CreateEvent(ctx(), events.CreateEventPayload{
		Name:        "Ceremony",
		LocationURL: pointerutil.String("https://maps.app.goo.gl/abc123"),
		Date:        "2026-10-17",
	})
	assertErrCode(t, err, errcodes.CodeValidationError)

	_, total, err := svc.ListEvents(ctx())
	require.NoError(t, err)
	assert.Zero(t, total, "the rejected create persisted nothing")
}

func TestUpdateEvent_RejectsLocationLinkWithoutLocation(t *testing.T) {
	svc, _, _ := newServices(t)
	created := createEventT(t, svc, privateEventInput())

	_, err := svc.UpdateEvent(ctx(), created.ID, events.UpdateEventPayload{
		Name:        created.Name,
		LocationURL: pointerutil.String("https://maps.app.goo.gl/abc123"),
		Date:        created.Date,
	})
	assertErrCode(t, err, errcodes.CodeValidationError)

	reloaded, err := svc.GetEvent(ctx(), created.ID)
	require.NoError(t, err)
	assert.Nil(t, reloaded.LocationURL, "the rejected update left the row unchanged")
}

func TestUpdateEvent_MissingIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	_, err := svc.UpdateEvent(ctx(), "00000000-0000-0000-0000-000000000000", events.UpdateEventPayload{
		Name: "Ghost", Date: "2026-10-17",
	})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUpdateEvent_FlippingToPublicBackfillsAllGuests(t *testing.T) {
	svc, partySvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")

	event := createEventT(t, svc, privateEventInput())
	require.Empty(t, rsvpsForEvent(t, db, event.ID))

	// Making the event public must restore the ADR 0002 invariant: a public
	// event has a row for every guest.
	_, err := svc.UpdateEvent(ctx(), event.ID, events.UpdateEventPayload{
		Name: event.Name, Date: event.Date, IsPublic: true,
	})
	require.NoError(t, err)

	rows := rsvpsForEvent(t, db, event.ID)
	require.Len(t, rows, 1)
	assert.Equal(t, models.RSVPPending, rows[g.ID].Status)
}

func TestUpdateEvent_FlippingToPrivateKeepsExistingRSVPs(t *testing.T) {
	svc, partySvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")

	event := createEventT(t, svc, publicEventInput())
	require.Len(t, rsvpsForEvent(t, db, event.ID), 1)

	// Going private never deletes responses; existing rows simply become the
	// invited set.
	_, err := svc.UpdateEvent(ctx(), event.ID, events.UpdateEventPayload{
		Name: event.Name, Date: event.Date, IsPublic: false,
	})
	require.NoError(t, err)
	assert.Len(t, rsvpsForEvent(t, db, event.ID), 1)
}

func TestDeleteEvent_RemovesEventAndRSVPs(t *testing.T) {
	svc, partySvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")
	event := createEventT(t, svc, publicEventInput())
	require.Len(t, rsvpsForEvent(t, db, event.ID), 1)

	require.NoError(t, svc.DeleteEvent(ctx(), event.ID))

	_, err := svc.GetEvent(ctx(), event.ID)
	assertErrCode(t, err, errcodes.CodeNotFound)
	assert.Empty(t, rsvpsForEvent(t, db, event.ID), "the FK cascade removes the rows")
}

func TestDeleteEvent_MissingIs404(t *testing.T) {
	svc, _, _ := newServices(t)
	err := svc.DeleteEvent(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}
