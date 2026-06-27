package info_test

import (
	"context"
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/internal/databasetest"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/info"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/uptrace/bun"
)

// newServices returns an info.Service plus the parties and events services used
// for fixtures, backed by a dedicated Postgres test database (these tests
// truncate parties and events, which other package binaries own in the shared
// database). Truncating parties/events cascades to guests and event_rsvps.
// Tests using it must not call t.Parallel() because the package shares this one
// database and relies on truncation for isolation.
func newServices(t *testing.T) (*info.Service, *parties.Service, *events.Service, *bun.DB) {
	t.Helper()
	db := newDB(t)
	return info.NewService(db), parties.NewService(db), events.NewService(db), db
}

// newInfoService is newServices for tests that need no fixtures (e.g. the
// unknown-token 404s).
func newInfoService(t *testing.T) *info.Service {
	t.Helper()
	return info.NewService(newDB(t))
}

// newDB provisions (and truncates) the package's dedicated test database.
func newDB(t *testing.T) *bun.DB {
	t.Helper()
	db := databasetest.NewIsolated(t, "robinandmadeline_info_test")
	databasetest.Truncate(t, db, "parties", "events")
	return db
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
func createPartyT(t *testing.T, svc *parties.Service, name, invitationType string) *models.Party {
	t.Helper()
	p, err := svc.CreateParty(ctx(), parties.CreatePartyPayload{
		Name:           name,
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		InvitationType: invitationType,
	})
	require.NoError(t, err)
	return p
}

// addGuestT adds a guest fixture to a party via the parties service.
func addGuestT(t *testing.T, svc *parties.Service, partyID string, in parties.CreateGuestPayload) *models.Guest {
	t.Helper()
	g, err := svc.CreateGuest(ctx(), partyID, in)
	require.NoError(t, err)
	return g
}

// addPrimaryT adds the party's primary guest fixture.
func addPrimaryT(t *testing.T, svc *parties.Service, partyID, name string) *models.Guest {
	t.Helper()
	return addGuestT(t, svc, partyID, parties.CreateGuestPayload{FullName: name, IsPrimary: true})
}

// addPlaceholderT adds a placeholder guest fixture (an unnamed plus-one slot).
// Like the CSV import, full_name and placeholder_text both start as the
// descriptor.
func addPlaceholderT(t *testing.T, svc *parties.Service, partyID, descriptor string) *models.Guest {
	t.Helper()
	return addGuestT(t, svc, partyID, parties.CreateGuestPayload{
		FullName:        descriptor,
		PlaceholderText: pointerutil.String(descriptor),
	})
}

// fullAddress returns an UpdatePartyInfoPayload pre-filled with a complete US
// mailing address (line 2 deliberately absent: it is optional). The country is
// the canonical "United States" so the postal code is genuinely gated, the
// strictest path.
func fullAddress() info.UpdatePartyInfoPayload {
	return info.UpdatePartyInfoPayload{
		AddressLine1:    pointerutil.String("123 Main St"),
		City:            pointerutil.String("Springfield"),
		StateOrProvince: pointerutil.String("IL"),
		PostalCode:      pointerutil.String("62701"),
		Country:         pointerutil.String("United States"),
	}
}

// partyRow reads one parties row straight from the DB.
func partyRow(t *testing.T, db *bun.DB, id string) *models.Party {
	t.Helper()
	row := new(models.Party)
	require.NoError(t, db.NewSelect().Model(row).Where("p.id = ?", id).Scan(ctx()))
	return row
}

// guestRow reads one guests row straight from the DB.
func guestRow(t *testing.T, db *bun.DB, id string) *models.Guest {
	t.Helper()
	row := new(models.Guest)
	require.NoError(t, db.NewSelect().Model(row).Where("g.id = ?", id).Scan(ctx()))
	return row
}

func TestPartyInfo_ReturnsPartyAndGuestDetails(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationPhysical)
	alice := addGuestT(t, partySvc, p.ID, parties.CreateGuestPayload{
		FullName:  "Alice Smith",
		Email:     pointerutil.String("alice@example.com"),
		Phone:     pointerutil.String("+14155552671"),
		IsPrimary: true,
	})
	bob := addGuestT(t, partySvc, p.ID, parties.CreateGuestPayload{FullName: "Bob Smith", IsChild: true})
	// The party's +1 slot exists but never surfaces here: placeholders are an
	// RSVP-flow concern, and info collection only covers known people.
	addPlaceholderT(t, partySvc, p.ID, "Guest of Alice")

	// An unrelated party never leaks into the token's view: not its guests, and
	// not its placeholder slots, so the count below must stay scoped to the
	// token's party.
	other := createPartyT(t, partySvc, "The Joneses", models.InvitationDigital)
	addPrimaryT(t, partySvc, other.ID, "Carol Jones")
	addPlaceholderT(t, partySvc, other.ID, "Guest of Carol")

	resp, err := svc.PartyInfo(ctx(), p.InfoToken)
	require.NoError(t, err)

	assert.Equal(t, models.InvitationPhysical, resp.InvitationType)
	require.Len(t, resp.Guests, 2, "only the token's party's known guests; the placeholder is excluded")
	assert.Equal(t, 1, resp.PlaceholderCount, "the excluded +1 slot is still counted, so the party knows it isn't solo")

	assert.Equal(t, alice.ID, resp.Guests[0].ID)
	assert.Equal(t, "Alice Smith", resp.Guests[0].FullName)
	assert.True(t, resp.Guests[0].IsPrimary)
	assert.False(t, resp.Guests[0].IsChild)
	assert.Equal(t, pointerutil.String("alice@example.com"), resp.Guests[0].Email)
	assert.Equal(t, pointerutil.String("+14155552671"), resp.Guests[0].Phone)

	assert.Equal(t, bob.ID, resp.Guests[1].ID)
	assert.False(t, resp.Guests[1].IsPrimary)
	assert.True(t, resp.Guests[1].IsChild, "the child flag projects through to the form view")
	assert.Nil(t, resp.Guests[1].Email)
}

func TestPartyInfo_OrdersGuestsWithinParty(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationPhysical)
	// Created out of display order: a child first, then an adult, then the
	// primary last, so the assertion proves the form reorders to primary, the
	// other adults, then the children rather than echoing creation order.
	addGuestT(t, partySvc, p.ID, parties.CreateGuestPayload{FullName: "Kid", IsChild: true})
	addGuestT(t, partySvc, p.ID, parties.CreateGuestPayload{FullName: "Adult"})
	addGuestT(t, partySvc, p.ID, parties.CreateGuestPayload{FullName: "Primary", IsPrimary: true})

	resp, err := svc.PartyInfo(ctx(), p.InfoToken)
	require.NoError(t, err)

	require.Len(t, resp.Guests, 3)
	got := []string{resp.Guests[0].FullName, resp.Guests[1].FullName, resp.Guests[2].FullName}
	assert.Equal(t, []string{"Primary", "Adult", "Kid"}, got)
	assert.Zero(t, resp.PlaceholderCount, "a party with no plus-one slots reports none")
}

func TestPartyInfo_CountsPlaceholderSlots(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)

	// One named guest plus two unnamed plus-one slots: the form shows only the
	// named guest, but the count tells the party two more are coming, named when
	// RSVPs open. The count and the shown guests are complements, so together
	// they cover the whole party.
	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	addPrimaryT(t, partySvc, p.ID, "Alice Smith")
	addPlaceholderT(t, partySvc, p.ID, "Guest of Alice")
	addPlaceholderT(t, partySvc, p.ID, "Second guest of Alice")

	resp, err := svc.PartyInfo(ctx(), p.InfoToken)
	require.NoError(t, err)

	require.Len(t, resp.Guests, 1, "the slots are not shown as guests")
	assert.Equal(t, 2, resp.PlaceholderCount, "both slots are counted")
}

func TestPartyInfo_UnknownTokenIs404(t *testing.T) {
	svc := newInfoService(t)

	_, err := svc.PartyInfo(ctx(), "no-such-token")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUpdatePartyInfo_SavesAddressContactsAndConfirms(t *testing.T) {
	svc, partySvc, _, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationPhysical)
	// The imported name is a best approximation; the form corrects it.
	alice := addPrimaryT(t, partySvc, p.ID, "Allice Smith")

	payload := fullAddress()
	payload.AddressLine2 = pointerutil.String("Apt 4")
	payload.Guests = []info.GuestInfoUpdate{{
		GuestID:  alice.ID,
		FullName: pointerutil.String("Alice Smith"),
		Email:    pointerutil.String("alice@example.com"),
		Phone:    pointerutil.String("+14155552671"),
	}}

	resp, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, payload)
	require.NoError(t, err)

	// The response reflects the refreshed state.
	assert.Equal(t, pointerutil.String("123 Main St"), resp.AddressLine1)
	assert.Equal(t, pointerutil.String("Apt 4"), resp.AddressLine2)
	require.Len(t, resp.Guests, 1)
	assert.Equal(t, "Alice Smith", resp.Guests[0].FullName)
	assert.Equal(t, pointerutil.String("alice@example.com"), resp.Guests[0].Email)

	// The corrected name and contacts persist; a successful submit confirms the
	// party (ADR 0005): requested+confirmed, so the status reads complete.
	g := guestRow(t, db, alice.ID)
	assert.Equal(t, "Alice Smith", g.FullName)
	assert.Equal(t, pointerutil.String("+14155552671"), g.Phone)

	saved := partyRow(t, db, p.ID)
	assert.Equal(t, pointerutil.String("Springfield"), saved.City)
	assert.True(t, saved.InfoCollectionRequested)
	assert.True(t, saved.InfoCollectionConfirmed)
	saved.Guests = []*models.Guest{g}
	assert.Equal(t, models.StatusComplete, saved.InfoCollectionStatus())
}

func TestUpdatePartyInfo_CompletesARequestedParty(t *testing.T) {
	svc, partySvc, _, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	// The couple sent the link: the party waits on the guest (ADR 0005).
	_, err := partySvc.RequestInfo(ctx(), p.ID)
	require.NoError(t, err)
	assert.False(t, partyRow(t, db, p.ID).InfoCollectionConfirmed)

	// The guest's form submission is what completes it.
	_, err = svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{GuestID: alice.ID, Email: pointerutil.String("alice@example.com")}},
	})
	require.NoError(t, err)

	saved := partyRow(t, db, p.ID)
	assert.True(t, saved.InfoCollectionRequested)
	assert.True(t, saved.InfoCollectionConfirmed)
}

func TestUpdatePartyInfo_MissingRequiredFieldsIs422AndRollsBack(t *testing.T) {
	svc, partySvc, _, db := newServices(t)

	// A physical party needs a full mailing address; an email alone is rejected,
	// and the rejection saves nothing (the whole submit is one transaction).
	p := createPartyT(t, partySvc, "The Smiths", models.InvitationPhysical)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{GuestID: alice.ID, Email: pointerutil.String("alice@example.com")}},
	})
	assertErrCode(t, err, errcodes.CodeValidationError)

	assert.Nil(t, guestRow(t, db, alice.ID).Email, "a rejected submit persists nothing")
	saved := partyRow(t, db, p.ID)
	assert.False(t, saved.InfoCollectionRequested)
	assert.False(t, saved.InfoCollectionConfirmed)
}

func TestUpdatePartyInfo_USAddressNeedsPostalCode(t *testing.T) {
	svc, partySvc, _, db := newServices(t)

	// A US address is gated on the postal code: an otherwise-complete address
	// missing only the ZIP fails the completion gate and rolls back.
	p := createPartyT(t, partySvc, "The Smiths", models.InvitationPhysical)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	payload := fullAddress() // Country is "United States".
	payload.PostalCode = nil // the one missing field
	payload.Guests = []info.GuestInfoUpdate{{
		GuestID: alice.ID,
		Email:   pointerutil.String("alice@example.com"),
	}}

	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, payload)
	assertErrCode(t, err, errcodes.CodeValidationError)
	assert.False(t, partyRow(t, db, p.ID).InfoCollectionConfirmed, "a rejected submit doesn't confirm")
}

func TestUpdatePartyInfo_InternationalAddressNeedsNoPostalCode(t *testing.T) {
	svc, partySvc, _, db := newServices(t)

	// A non-US address has no postal-code requirement (many countries have
	// none), so the very same address minus the ZIP saves and confirms.
	p := createPartyT(t, partySvc, "The Tremblays", models.InvitationPhysical)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Tremblay")

	payload := fullAddress()
	payload.PostalCode = nil
	payload.Country = pointerutil.String("Canada")
	payload.Guests = []info.GuestInfoUpdate{{
		GuestID: alice.ID,
		Email:   pointerutil.String("alice@example.com"),
	}}

	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, payload)
	require.NoError(t, err)

	saved := partyRow(t, db, p.ID)
	assert.True(t, saved.InfoCollectionConfirmed, "a complete non-US address confirms")
	assert.Nil(t, saved.PostalCode, "no postal code was provided or required")
}

func TestUpdatePartyInfo_MissingPrimaryEmailIs422(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)

	// Even a digital party (no address needed) requires the primary's email; a
	// blank submit clears it, so the gate rejects the form.
	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{GuestID: alice.ID, Email: pointerutil.String("")}},
	})
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestUpdatePartyInfo_DigitalPartyNeedsNoAddress(t *testing.T) {
	svc, partySvc, _, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{GuestID: alice.ID, Email: pointerutil.String("alice@example.com")}},
	})
	require.NoError(t, err)

	saved := partyRow(t, db, p.ID)
	assert.True(t, saved.InfoCollectionConfirmed)
	assert.Nil(t, saved.AddressLine1, "an absent address field stays untouched")
}

func TestUpdatePartyInfo_BlankNameForRegularGuestIs422(t *testing.T) {
	svc, partySvc, _, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	// A real guest's name can be corrected, never cleared: a blank edit is
	// rejected outright, and the rejection rolls back the whole submit.
	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{
			GuestID:  alice.ID,
			FullName: pointerutil.String(""),
			Email:    pointerutil.String("alice@example.com"),
		}},
	})
	assertErrCode(t, err, errcodes.CodeValidationError)

	saved := guestRow(t, db, alice.ID)
	assert.Equal(t, "Alice Smith", saved.FullName)
	assert.Nil(t, saved.Email, "a rejected submit persists nothing")

	// An absent name is still fine: contact-only updates leave the name alone.
	_, err = svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{
			GuestID: alice.ID,
			Email:   pointerutil.String("alice@example.com"),
		}},
	})
	require.NoError(t, err)
	assert.Equal(t, "Alice Smith", guestRow(t, db, alice.ID).FullName)
}

func TestUpdatePartyInfo_PlaceholderGuestIs422(t *testing.T) {
	svc, partySvc, _, db := newServices(t)

	// Placeholder slots are invisible to the info flow (naming them is the
	// RSVP form's job), so addressing one is rejected exactly like a guest
	// from another party, whether the entry is an update or a removal.
	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")
	plusOne := addPlaceholderT(t, partySvc, p.ID, "Guest of Alice")

	primaryEmail := info.GuestInfoUpdate{GuestID: alice.ID, Email: pointerutil.String("alice@example.com")}

	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{primaryEmail, {GuestID: plusOne.ID, FullName: pointerutil.String("Dana Lee")}},
	})
	assertErrCode(t, err, errcodes.CodeValidationError)
	assert.Equal(t, "Guest of Alice", guestRow(t, db, plusOne.ID).FullName,
		"the slot stays unnamed; nothing from the rejected submit persists")

	_, err = svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{primaryEmail, {GuestID: plusOne.ID, Remove: true}},
	})
	assertErrCode(t, err, errcodes.CodeValidationError)

	exists, err := db.NewSelect().Model((*models.Guest)(nil)).Where("id = ?", plusOne.ID).Exists(ctx())
	require.NoError(t, err)
	assert.True(t, exists, "the slot survives; giving up a +1 is not an info-flow action")
}

func TestUpdatePartyInfo_RefreshedResponseCountsPlaceholders(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)

	// The refreshed view a successful submit returns carries the placeholder
	// count too, so the "Make changes" return trip still shows the party it
	// isn't solo.
	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")
	addPlaceholderT(t, partySvc, p.ID, "Guest of Alice")

	resp, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{GuestID: alice.ID, Email: pointerutil.String("alice@example.com")}},
	})
	require.NoError(t, err)

	require.Len(t, resp.Guests, 1, "the slot is still not shown as a guest")
	assert.Equal(t, 1, resp.PlaceholderCount, "the refreshed view still reports the slot")
}

func TestUpdatePartyInfo_RemovesGuestAndTheirEventRSVPs(t *testing.T) {
	svc, partySvc, eventSvc, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")
	ex := addGuestT(t, partySvc, p.ID, parties.CreateGuestPayload{FullName: "Ex Partner"})

	// A public event backfills a pending Event RSVP for both guests (ADR 0002).
	event, err := eventSvc.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Reception", Date: "2026-10-17", IsPublic: true,
	})
	require.NoError(t, err)

	resp, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{
			{GuestID: alice.ID, Email: pointerutil.String("alice@example.com")},
			{GuestID: ex.ID, Remove: true},
		},
	})
	require.NoError(t, err)

	// Gone from the response, the guests table, and the event's RSVPs.
	require.Len(t, resp.Guests, 1)
	assert.Equal(t, alice.ID, resp.Guests[0].ID)

	exists, err := db.NewSelect().Model((*models.Guest)(nil)).Where("id = ?", ex.ID).Exists(ctx())
	require.NoError(t, err)
	assert.False(t, exists, "the removed guest is deleted")

	rsvpCount, err := db.NewSelect().Model((*models.EventRSVP)(nil)).
		Where("event_id = ?", event.ID).Where("guest_id = ?", ex.ID).Count(ctx())
	require.NoError(t, err)
	assert.Zero(t, rsvpCount, "the removed guest's Event RSVPs are deleted")
}

func TestUpdatePartyInfo_PrimaryRemovalIs422(t *testing.T) {
	svc, partySvc, _, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")
	addGuestT(t, partySvc, p.ID, parties.CreateGuestPayload{FullName: "Bob Smith"})

	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{GuestID: alice.ID, Remove: true}},
	})
	assertErrCode(t, err, errcodes.CodeValidationError)

	exists, err := db.NewSelect().Model((*models.Guest)(nil)).Where("id = ?", alice.ID).Exists(ctx())
	require.NoError(t, err)
	assert.True(t, exists, "the primary guest is never removed")
}

func TestUpdatePartyInfo_GuestOutsidePartyIs422(t *testing.T) {
	svc, partySvc, _, _ := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	addPrimaryT(t, partySvc, p.ID, "Alice Smith")
	other := createPartyT(t, partySvc, "The Joneses", models.InvitationDigital)
	carol := addPrimaryT(t, partySvc, other.ID, "Carol Jones")

	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{GuestID: carol.ID, Email: pointerutil.String("x@example.com")}},
	})
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestUpdatePartyInfo_UnknownTokenIs404(t *testing.T) {
	svc := newInfoService(t)

	_, err := svc.UpdatePartyInfo(ctx(), "no-such-token", info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{GuestID: "00000000-0000-0000-0000-000000000000"}},
	})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUpdatePartyInfo_RevisitUpdatesValues(t *testing.T) {
	svc, partySvc, _, db := newServices(t)

	p := createPartyT(t, partySvc, "The Smiths", models.InvitationDigital)
	alice := addPrimaryT(t, partySvc, p.ID, "Alice Smith")

	_, err := svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{GuestID: alice.ID, Email: pointerutil.String("old@example.com")}},
	})
	require.NoError(t, err)

	// The same link keeps working: a second submit updates the saved values and
	// the party stays confirmed.
	_, err = svc.UpdatePartyInfo(ctx(), p.InfoToken, info.UpdatePartyInfoPayload{
		Guests: []info.GuestInfoUpdate{{
			GuestID: alice.ID,
			Email:   pointerutil.String("new@example.com"),
			Phone:   pointerutil.String("+14155552671"),
		}},
	})
	require.NoError(t, err)

	g := guestRow(t, db, alice.ID)
	assert.Equal(t, pointerutil.String("new@example.com"), g.Email)
	assert.Equal(t, pointerutil.String("+14155552671"), g.Phone)
	assert.True(t, partyRow(t, db, p.ID).InfoCollectionConfirmed)
}
