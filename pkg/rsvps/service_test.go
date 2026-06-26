package rsvps_test

import (
	"context"
	"testing"
	"time"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/rsvps"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// newServices returns an rsvps.Service plus the parties and events services
// used for fixtures, backed by a dedicated Postgres test database (these tests
// truncate parties and events, which other package binaries own in the shared
// database). Truncating parties/events cascades to guests and event_rsvps.
// Tests using it must not call t.Parallel() because the package shares this
// one database and relies on truncation for isolation.
func newServices(t *testing.T) (*rsvps.Service, *parties.Service, *events.Service, *bun.DB) {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_rsvps_test")
	databasetest.Truncate(t, db, "parties", "events", "app_settings")
	return rsvps.NewService(db), parties.NewService(db), events.NewService(db), db
}

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

// addGuestWithT adds a guest fixture with explicit flags (is_primary / is_child),
// for tests that exercise the within-party guest order.
func addGuestWithT(t *testing.T, svc *parties.Service, partyID string, in parties.CreateGuestPayload) *models.Guest {
	t.Helper()
	g, err := svc.CreateGuest(ctx(), partyID, in)
	require.NoError(t, err)
	return g
}

// addPlaceholderT adds a placeholder guest fixture (an unnamed plus-one slot
// the party names during RSVP). Like the CSV import, full_name and
// placeholder_text both start as the descriptor.
func addPlaceholderT(t *testing.T, svc *parties.Service, partyID, name string) *models.Guest {
	t.Helper()
	g, err := svc.CreateGuest(ctx(), partyID, parties.CreateGuestPayload{
		FullName:        name,
		PlaceholderText: pointerutil.String(name),
	})
	require.NoError(t, err)
	return g
}

// createPublicEventT creates the public "Reception" event (which backfills a
// pending Event RSVP for every existing guest, ADR 0002). Its date sorts after
// createPrivateEventT's rehearsal dinner.
func createPublicEventT(t *testing.T, svc *events.Service) *models.Event {
	t.Helper()
	e, err := svc.CreateEvent(ctx(), events.CreateEventPayload{Name: "Reception", Date: "2026-10-17", IsPublic: true})
	require.NoError(t, err)
	return e
}

// createPrivateEventT creates a private event and invites the given parties.
func createPrivateEventT(t *testing.T, svc *events.Service, name, date string, partyIDs ...string) *models.Event {
	t.Helper()
	e, err := svc.CreateEvent(ctx(), events.CreateEventPayload{Name: name, Date: date, IsPublic: false})
	require.NoError(t, err)
	if len(partyIDs) > 0 {
		_, err = svc.InviteParties(ctx(), e.ID, events.InvitePartiesPayload{PartyIDs: partyIDs})
		require.NoError(t, err)
	}
	return e
}

// setSetting upserts one app_settings row.
func setSetting(t *testing.T, db *bun.DB, key, value string) {
	t.Helper()
	_, err := db.NewInsert().Model(&models.AppSetting{Key: key, Value: value}).
		On("CONFLICT (key) DO UPDATE SET value = EXCLUDED.value").Exec(ctx())
	require.NoError(t, err)
}

// setDeadline stores the RSVP deadline offset from now (negative = past).
func setDeadline(t *testing.T, db *bun.DB, offset time.Duration) {
	t.Helper()
	setSetting(t, db, models.AppSettingRSVPDeadline, time.Now().Add(offset).Format(time.RFC3339))
}

// rsvpRow reads one event_rsvps row straight from the DB.
func rsvpRow(t *testing.T, db *bun.DB, eventID, guestID string) *models.EventRSVP {
	t.Helper()
	row := new(models.EventRSVP)
	err := db.NewSelect().Model(row).
		Where("event_id = ?", eventID).Where("guest_id = ?", guestID).Scan(ctx())
	require.NoError(t, err)
	return row
}

// guestRow reads one guests row straight from the DB.
func guestRow(t *testing.T, db *bun.DB, guestID string) *models.Guest {
	t.Helper()
	row := new(models.Guest)
	err := db.NewSelect().Model(row).Where("id = ?", guestID).Scan(ctx())
	require.NoError(t, err)
	return row
}

// statusUpdate builds the single-guest, single-event update payload most tests
// submit.
func statusUpdate(guestID, eventID, status string) rsvps.UpdatePartyRSVPsPayload {
	return rsvps.UpdatePartyRSVPsPayload{Guests: []rsvps.GuestRSVPUpdate{{
		GuestID: guestID,
		RSVPs:   []rsvps.EventRSVPUpdate{{EventID: eventID, Status: status}},
	}}}
}

func TestPartyRSVPs_OrdersGuestsWithinParty(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)

	smiths := createPartyT(t, partySvc, "The Smiths")
	// Created out of display order: a child first, then an adult, then the
	// primary last, so the assertion proves the form reorders to primary, the
	// other adults, then the children rather than echoing creation order.
	addGuestWithT(t, partySvc, smiths.ID, parties.CreateGuestPayload{FullName: "Kid", IsChild: true})
	addGuestWithT(t, partySvc, smiths.ID, parties.CreateGuestPayload{FullName: "Adult"})
	addGuestWithT(t, partySvc, smiths.ID, parties.CreateGuestPayload{FullName: "Primary", IsPrimary: true})

	resp, err := svc.PartyRSVPs(ctx(), smiths.ID)
	require.NoError(t, err)

	require.Len(t, resp.Guests, 3)
	got := []string{resp.Guests[0].FullName, resp.Guests[1].FullName, resp.Guests[2].FullName}
	assert.Equal(t, []string{"Primary", "Adult", "Kid"}, got)
}

func TestPartyRSVPs_GroupsThePartysRSVPsByEvent(t *testing.T) {
	svc, partySvc, eventSvc, _ := newServices(t)

	smiths := createPartyT(t, partySvc, "The Smiths")
	alice := addGuestT(t, partySvc, smiths.ID, "Alice")
	bob := addGuestT(t, partySvc, smiths.ID, "Bob")
	joneses := createPartyT(t, partySvc, "The Joneses")
	addGuestT(t, partySvc, joneses.ID, "Carol")

	// The reception is public (everyone is invited); the rehearsal dinner is
	// private and only the Smiths are invited. Dates put the dinner first.
	reception := createPublicEventT(t, eventSvc)
	dinner := createPrivateEventT(t, eventSvc, "Rehearsal Dinner", "2026-10-16", smiths.ID)

	resp, err := svc.PartyRSVPs(ctx(), smiths.ID)
	require.NoError(t, err)

	require.Len(t, resp.Guests, 2, "only the authenticated party's guests appear")
	assert.Equal(t, alice.ID, resp.Guests[0].ID, "neither guest is primary or a child, so they fall back to creation order")
	assert.Equal(t, bob.ID, resp.Guests[1].ID)

	require.Len(t, resp.Events, 2)
	assert.Equal(t, dinner.ID, resp.Events[0].ID, "events come back in schedule order")
	assert.Equal(t, reception.ID, resp.Events[1].ID)
	for _, ev := range resp.Events {
		require.Len(t, ev.RSVPs, 2, "every party guest is invited to both events")
		for _, entry := range ev.RSVPs {
			assert.Contains(t, []string{alice.ID, bob.ID}, entry.GuestID, "no other party's rows leak in")
			assert.Equal(t, models.RSVPPending, entry.Status)
		}
	}
}

func TestPartyRSVPs_ExcludesEventsThePartyIsNotInvitedTo(t *testing.T) {
	svc, partySvc, eventSvc, _ := newServices(t)

	smiths := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, smiths.ID, "Alice")
	joneses := createPartyT(t, partySvc, "The Joneses")
	addGuestT(t, partySvc, joneses.ID, "Carol")

	createPrivateEventT(t, eventSvc, "Rehearsal Dinner", "2026-10-16", joneses.ID)

	resp, err := svc.PartyRSVPs(ctx(), smiths.ID)
	require.NoError(t, err)
	assert.Empty(t, resp.Events, "a private event the party is not invited to never appears")
}

func TestPartyRSVPs_OpenWhenNoDeadlineSet(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)
	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")

	resp, err := svc.PartyRSVPs(ctx(), p.ID)
	require.NoError(t, err)
	assert.False(t, resp.Closed, "no deadline means RSVPs stay open")
	assert.Nil(t, resp.RSVPDeadline)
	assert.Nil(t, resp.ContactEmail)
}

func TestPartyRSVPs_OpenBeforeDeadline(t *testing.T) {
	svc, partySvc, _, db := newServices(t)
	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")
	setDeadline(t, db, 24*time.Hour)

	resp, err := svc.PartyRSVPs(ctx(), p.ID)
	require.NoError(t, err)
	assert.False(t, resp.Closed)
	require.NotNil(t, resp.RSVPDeadline)
}

func TestPartyRSVPs_ClosedAfterDeadlineWithContactEmail(t *testing.T) {
	svc, partySvc, _, db := newServices(t)
	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")
	setDeadline(t, db, -24*time.Hour)
	setSetting(t, db, models.AppSettingContactEmail, "couple@example.com")

	resp, err := svc.PartyRSVPs(ctx(), p.ID)
	require.NoError(t, err)
	assert.True(t, resp.Closed, "a past deadline closes RSVPs")
	require.NotNil(t, resp.ContactEmail)
	assert.Equal(t, "couple@example.com", *resp.ContactEmail)
}

func TestPartyRSVPs_RespondedReflectsAnyAnsweredRSVP(t *testing.T) {
	svc, partySvc, eventSvc, _ := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	alice := addGuestT(t, partySvc, p.ID, "Alice")
	addGuestT(t, partySvc, p.ID, "Bob")
	event := createPublicEventT(t, eventSvc)

	// Every row pending: the party has not responded yet.
	resp, err := svc.PartyRSVPs(ctx(), p.ID)
	require.NoError(t, err)
	assert.False(t, resp.Responded, "an all-pending party has not responded")

	// A single guest answering (even "not attending") counts as a response.
	resp, err = svc.UpdatePartyRSVPs(ctx(), p.ID, statusUpdate(alice.ID, event.ID, models.RSVPNotAttending))
	require.NoError(t, err)
	assert.True(t, resp.Responded, "one answered RSVP marks the party as responded")

	resp, err = svc.PartyRSVPs(ctx(), p.ID)
	require.NoError(t, err)
	assert.True(t, resp.Responded, "a fresh read sees the same responded state")

	// Withdrawing the only answer back to pending clears rsvped_at, so the
	// party reads as unresponded again.
	resp, err = svc.UpdatePartyRSVPs(ctx(), p.ID, statusUpdate(alice.ID, event.ID, models.RSVPPending))
	require.NoError(t, err)
	assert.False(t, resp.Responded, "withdrawing every answer clears responded")
}

func TestPartyRSVPs_MissingPartyIs404(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)
	createPartyT(t, partySvc, "The Smiths")

	// A real party exists, but the requested id names no party (e.g. it was
	// deleted while a guest token for it was still live).
	_, err := svc.PartyRSVPs(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUpdatePartyRSVPs_TransitionsStatusesAndStampsRSVPedAt(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createPublicEventT(t, eventSvc)

	// pending -> attending stamps the response time.
	resp, err := svc.UpdatePartyRSVPs(ctx(), p.ID, statusUpdate(g.ID, event.ID, models.RSVPAttending))
	require.NoError(t, err)
	require.Len(t, resp.Events, 1)
	require.Len(t, resp.Events[0].RSVPs, 1)
	assert.Equal(t, models.RSVPAttending, resp.Events[0].RSVPs[0].Status, "the response reflects the new state")

	row := rsvpRow(t, db, event.ID, g.ID)
	assert.Equal(t, models.RSVPAttending, row.Status)
	require.NotNil(t, row.RSVPedAt, "a response stamps rsvped_at")

	// attending -> not_attending: guests can change their mind before the
	// deadline.
	_, err = svc.UpdatePartyRSVPs(ctx(), p.ID, statusUpdate(g.ID, event.ID, models.RSVPNotAttending))
	require.NoError(t, err)
	row = rsvpRow(t, db, event.ID, g.ID)
	assert.Equal(t, models.RSVPNotAttending, row.Status)
	require.NotNil(t, row.RSVPedAt)

	// ...and back to pending clears the response timestamp.
	_, err = svc.UpdatePartyRSVPs(ctx(), p.ID, statusUpdate(g.ID, event.ID, models.RSVPPending))
	require.NoError(t, err)
	row = rsvpRow(t, db, event.ID, g.ID)
	assert.Equal(t, models.RSVPPending, row.Status)
	assert.Nil(t, row.RSVPedAt)
}

func TestUpdatePartyRSVPs_PersistsPlaceholderNameAndDietary(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	alice := addGuestT(t, partySvc, p.ID, "Alice")
	plusOne := addPlaceholderT(t, partySvc, p.ID, "Guest of Alice")
	createPublicEventT(t, eventSvc)

	_, err := svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{
			{GuestID: alice.ID, DietaryRestrictions: pointerutil.String("vegetarian")},
			{GuestID: plusOne.ID, FullName: pointerutil.String("Dana Lee"), DietaryRestrictions: pointerutil.String("no nuts")},
		},
	})
	require.NoError(t, err)

	updatedPlusOne := guestRow(t, db, plusOne.ID)
	assert.Equal(t, "Dana Lee", updatedPlusOne.FullName, "the placeholder's real name is filled in")
	assert.Equal(t, pointerutil.String("Guest of Alice"), updatedPlusOne.PlaceholderText,
		"naming a placeholder never erases the descriptor, so the name stays editable for corrections and swaps")
	require.NotNil(t, updatedPlusOne.DietaryRestrictions)
	assert.Equal(t, "no nuts", *updatedPlusOne.DietaryRestrictions)

	updatedAlice := guestRow(t, db, alice.ID)
	require.NotNil(t, updatedAlice.DietaryRestrictions)
	assert.Equal(t, "vegetarian", *updatedAlice.DietaryRestrictions)

	// The swap scenario: a named +1 cancels and the party brings someone else.
	// Renaming an already-named placeholder stays allowed until the deadline.
	_, err = svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: plusOne.ID, FullName: pointerutil.String("Evan Park")}},
	})
	require.NoError(t, err)
	renamed := guestRow(t, db, plusOne.ID)
	assert.Equal(t, "Evan Park", renamed.FullName, "an already-named placeholder can be renamed before the deadline")
	assert.Equal(t, pointerutil.String("Guest of Alice"), renamed.PlaceholderText)
}

func TestUpdatePartyRSVPs_BlankNameRevertsPlaceholderToUnnamed(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, p.ID, "Alice")
	plusOne := addPlaceholderT(t, partySvc, p.ID, "Guest of Alice")
	createPublicEventT(t, eventSvc)

	_, err := svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: plusOne.ID, FullName: pointerutil.String("Dana Lee")}},
	})
	require.NoError(t, err)
	require.Equal(t, "Dana Lee", guestRow(t, db, plusOne.ID).FullName)

	// An absent full_name leaves the name on file untouched: only the fields a
	// submission carries change.
	_, err = svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: plusOne.ID}},
	})
	require.NoError(t, err)
	assert.Equal(t, "Dana Lee", guestRow(t, db, plusOne.ID).FullName,
		"an absent name is a no-op for a named placeholder")

	// The breakup scenario: the named +1 is no longer coming and nobody
	// replaces them. A present-but-blank name reverts the slot to unnamed: the
	// descriptor becomes the name again.
	_, err = svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: plusOne.ID, FullName: pointerutil.String("")}},
	})
	require.NoError(t, err)
	reverted := guestRow(t, db, plusOne.ID)
	assert.Equal(t, "Guest of Alice", reverted.FullName,
		"a blank name reverts a named placeholder to its descriptor")
	assert.Equal(t, pointerutil.String("Guest of Alice"), reverted.PlaceholderText,
		"clearing the name never touches the descriptor")

	// Clearing an already-unnamed slot is a harmless no-op (the form may send
	// blank for an untouched empty input).
	_, err = svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: plusOne.ID, FullName: pointerutil.String("")}},
	})
	require.NoError(t, err)
	assert.Equal(t, "Guest of Alice", guestRow(t, db, plusOne.ID).FullName)
}

func TestUpdatePartyRSVPs_IgnoresNameForNonPlaceholderGuests(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	alice := addGuestT(t, partySvc, p.ID, "Alice")
	createPublicEventT(t, eventSvc)

	// Real guests' names are admin-managed; the RSVP flow only names
	// placeholders.
	_, err := svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: alice.ID, FullName: pointerutil.String("Mallory")}},
	})
	require.NoError(t, err)
	assert.Equal(t, "Alice", guestRow(t, db, alice.ID).FullName)

	// A blank name is just as ignored: revert-to-unnamed only means something
	// for placeholders, so a regular guest can never be blanked out.
	_, err = svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: alice.ID, FullName: pointerutil.String("")}},
	})
	require.NoError(t, err)
	assert.Equal(t, "Alice", guestRow(t, db, alice.ID).FullName)
}

func TestUpdatePartyRSVPs_BlankDietaryClearsToNull(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	alice := addGuestT(t, partySvc, p.ID, "Alice")
	createPublicEventT(t, eventSvc)

	_, err := svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: alice.ID, DietaryRestrictions: pointerutil.String("vegetarian")}},
	})
	require.NoError(t, err)

	// Re-submitting without a dietary value (the form cleared it) stores NULL.
	_, err = svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: alice.ID}},
	})
	require.NoError(t, err)
	assert.Nil(t, guestRow(t, db, alice.ID).DietaryRestrictions)

	// A present-but-blank value (a raw API caller; the form omits blanks) also
	// stores NULL, so the column never mixes "" and NULL.
	_, err = svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: alice.ID, DietaryRestrictions: pointerutil.String("vegetarian")}},
	})
	require.NoError(t, err)
	_, err = svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: alice.ID, DietaryRestrictions: pointerutil.String("")}},
	})
	require.NoError(t, err)
	assert.Nil(t, guestRow(t, db, alice.ID).DietaryRestrictions)
}

func TestUpdatePartyRSVPs_RejectedAfterDeadline(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createPublicEventT(t, eventSvc)
	setDeadline(t, db, -time.Hour)

	_, err := svc.UpdatePartyRSVPs(ctx(), p.ID, statusUpdate(g.ID, event.ID, models.RSVPAttending))
	assertErrCode(t, err, errcodes.CodeForbidden)

	row := rsvpRow(t, db, event.ID, g.ID)
	assert.Equal(t, models.RSVPPending, row.Status, "a rejected submission changes nothing")
}

func TestUpdatePartyRSVPs_AllowedRightUpToTheDeadline(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	event := createPublicEventT(t, eventSvc)
	setDeadline(t, db, time.Hour)

	_, err := svc.UpdatePartyRSVPs(ctx(), p.ID, statusUpdate(g.ID, event.ID, models.RSVPAttending))
	require.NoError(t, err)
	assert.Equal(t, models.RSVPAttending, rsvpRow(t, db, event.ID, g.ID).Status)
}

func TestUpdatePartyRSVPs_RejectsGuestOutsideTheParty(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)

	smiths := createPartyT(t, partySvc, "The Smiths")
	addGuestT(t, partySvc, smiths.ID, "Alice")
	joneses := createPartyT(t, partySvc, "The Joneses")
	carol := addGuestT(t, partySvc, joneses.ID, "Carol")
	event := createPublicEventT(t, eventSvc)

	// A guest token for the Smiths must not be able to answer for Carol.
	_, err := svc.UpdatePartyRSVPs(ctx(), smiths.ID, statusUpdate(carol.ID, event.ID, models.RSVPAttending))
	assertErrCode(t, err, errcodes.CodeValidationError)
	assert.Equal(t, models.RSVPPending, rsvpRow(t, db, event.ID, carol.ID).Status)
}

func TestUpdatePartyRSVPs_RejectsUninvitedEventAndStaysAtomic(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths")
	g := addGuestT(t, partySvc, p.ID, "Alice")
	invited := createPublicEventT(t, eventSvc)
	// A private event nobody invited the Smiths to: there is no Event RSVP row,
	// and the row is the invitation (ADR 0002), so the guest cannot create one.
	uninvited := createPrivateEventT(t, eventSvc, "Rehearsal Dinner", "2026-10-16")

	_, err := svc.UpdatePartyRSVPs(ctx(), p.ID, rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{
			GuestID: g.ID,
			RSVPs: []rsvps.EventRSVPUpdate{
				{EventID: invited.ID, Status: models.RSVPAttending},
				{EventID: uninvited.ID, Status: models.RSVPAttending},
			},
		}},
	})
	assertErrCode(t, err, errcodes.CodeValidationError)

	// The whole submission rolls back: even the valid entry stays pending.
	assert.Equal(t, models.RSVPPending, rsvpRow(t, db, invited.ID, g.ID).Status)
}

func TestUpdatePartyRSVPs_MissingPartyIs404(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)
	createPartyT(t, partySvc, "The Smiths")

	_, err := svc.UpdatePartyRSVPs(ctx(), "00000000-0000-0000-0000-000000000000", rsvps.UpdatePartyRSVPsPayload{
		Guests: []rsvps.GuestRSVPUpdate{{GuestID: "00000000-0000-0000-0000-000000000001"}},
	})
	assertErrCode(t, err, errcodes.CodeNotFound)
}
