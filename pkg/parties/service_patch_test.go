package parties_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPatchParty_UpdatesOnlyProvidedField(t *testing.T) {
	svc, _ := newService(t)

	// A digital party in the "College" circle. Patching only the name must change
	// the name and leave every other field exactly as it was: a partial update
	// touches only the columns it was given.
	p := createPartyT(t, svc, digitalPartyInput())

	updated, err := svc.PatchParty(ctx(), p.ID, parties.PatchPartyPayload{
		Name: pointerutil.String("The Smith-Joneses"),
	})
	require.NoError(t, err)

	assert.Equal(t, "The Smith-Joneses", updated.Name)
	assert.Equal(t, p.Side, updated.Side, "side must be untouched")
	assert.Equal(t, p.Relation, updated.Relation, "relation must be untouched")
	assert.Equal(t, p.InvitationType, updated.InvitationType, "invitation_type must be untouched")
	assert.Equal(t, p.Circle, updated.Circle, "circle must be untouched")
}

func TestPatchParty_DoesNotTouchCollectionFlags(t *testing.T) {
	svc, _ := newService(t)

	// Mark a party complete (sets requested+confirmed), then patch a field. The
	// edit must not reset the collection flags (ADR 0005): they move only through
	// the dedicated transition endpoints, and the patch column set excludes them.
	p := createPartyT(t, svc, physicalPartyInput())
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Pat Jones", Email: pointerutil.String("pat@example.com"), IsPrimary: true})
	line1, city, state, postal, country := fullAddress()
	updatePartyAddress(t, svc, p.ID, line1, city, state, postal, country)

	marked, err := svc.MarkComplete(ctx(), p.ID)
	require.NoError(t, err)
	require.True(t, marked.InfoCollectionRequested)
	require.True(t, marked.InfoCollectionConfirmed)

	updated, err := svc.PatchParty(ctx(), p.ID, parties.PatchPartyPayload{
		Name: pointerutil.String("The Jones Family"),
	})
	require.NoError(t, err)
	assert.True(t, updated.InfoCollectionRequested, "edit must not clear requested")
	assert.True(t, updated.InfoCollectionConfirmed, "edit must not clear confirmed")
	assert.Equal(t, "The Jones Family", updated.Name)
}

func TestPatchParty_SetsAndClearsRSVPCode(t *testing.T) {
	svc, _ := newService(t)

	// Setting the code persists it; clearing it (a provided blank value) must store
	// SQL NULL, not "", so the cleared party leaves the partial unique index.
	a := createPartyT(t, svc, digitalPartyInput())
	set, err := svc.PatchParty(ctx(), a.ID, parties.PatchPartyPayload{RSVPCode: pointerutil.String("DARKSEID")})
	require.NoError(t, err)
	require.Equal(t, "DARKSEID", *set.RSVPCode)

	cleared, err := svc.PatchParty(ctx(), a.ID, parties.PatchPartyPayload{RSVPCode: pointerutil.String("")})
	require.NoError(t, err)
	assert.Nil(t, cleared.RSVPCode, "a blank rsvp_code patch must clear to NULL")

	reloaded, err := svc.GetParty(ctx(), a.ID)
	require.NoError(t, err)
	assert.Nil(t, reloaded.RSVPCode)

	// Two parties may both have a cleared code: the partial unique index permits
	// many NULLs, which would fail if blank had been stored as "".
	b := createPartyT(t, svc, digitalPartyInput())
	_, err = svc.PatchParty(ctx(), b.ID, parties.PatchPartyPayload{RSVPCode: pointerutil.String("")})
	require.NoError(t, err, "a second cleared code must not collide with the first")
}

func TestPatchParty_DuplicateRSVPCodeConflicts(t *testing.T) {
	svc, _ := newService(t)

	a := digitalPartyInput()
	a.RSVPCode = pointerutil.String("PEPPER")
	createPartyT(t, svc, a)
	b := createPartyT(t, svc, digitalPartyInput())

	// Patching b to reuse a's code must conflict (409), the same as the PUT path.
	_, err := svc.PatchParty(ctx(), b.ID, parties.PatchPartyPayload{RSVPCode: pointerutil.String("PEPPER")})
	assertErrCode(t, err, errcodes.CodeConflict)
}

func TestPatchParty_NotFound(t *testing.T) {
	svc, _ := newService(t)
	_, err := svc.PatchParty(ctx(), "00000000-0000-0000-0000-000000000000", parties.PatchPartyPayload{
		Name: pointerutil.String("x"),
	})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestPatchGuest_UpdatesOnlyProvidedField(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())

	// A guest carrying contact details, tags, and a flag. Patching only the name
	// must leave email, phone, tags, and is_child exactly as they were: unlike the
	// full-state PUT, a partial update never silently resets the fields it was not
	// given (the reason the grid uses PATCH).
	g := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{
		FullName: "Pat",
		Email:    pointerutil.String("pat@example.com"),
		Phone:    pointerutil.String("555-1234"),
		Tags:     []string{"Bridesmaid"},
		IsChild:  true,
	})

	updated, err := svc.PatchGuest(ctx(), g.ID, parties.PatchGuestPayload{
		FullName: pointerutil.String("Patricia"),
	})
	require.NoError(t, err)

	assert.Equal(t, "Patricia", updated.FullName)
	require.NotNil(t, updated.Email)
	assert.Equal(t, "pat@example.com", *updated.Email, "email must be untouched")
	require.NotNil(t, updated.Phone)
	assert.Equal(t, "555-1234", *updated.Phone, "phone must be untouched")
	assert.Equal(t, []string{"Bridesmaid"}, updated.Tags, "tags must be untouched")
	assert.True(t, updated.IsChild, "is_child must be untouched")
}

func TestPatchGuest_PromotingDemotesPreviousPrimary(t *testing.T) {
	svc, db := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())

	primary := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Primary", IsPrimary: true})
	other := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Other"})

	// Promoting the other guest via a partial update must demote the previous
	// primary, keeping exactly one primary per party.
	_, err := svc.PatchGuest(ctx(), other.ID, parties.PatchGuestPayload{IsPrimary: pointerutil.Bool(true)})
	require.NoError(t, err)

	assert.Equal(t, 1, countPrimaries(t, db, p.ID))
	rePrimary, err := svc.GetGuest(ctx(), primary.ID)
	require.NoError(t, err)
	assert.False(t, rePrimary.IsPrimary, "previous primary should have been demoted")
}

func TestPatchGuest_ClearsEmailToNull(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())
	g := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Pat", Email: pointerutil.String("pat@example.com")})

	// A provided blank email is the grid's "erase the cell" gesture: it clears to
	// SQL NULL (emailblank lets it pass validation, the service nils it).
	updated, err := svc.PatchGuest(ctx(), g.ID, parties.PatchGuestPayload{Email: pointerutil.String("")})
	require.NoError(t, err)
	assert.Nil(t, updated.Email, "a blank email patch must clear to NULL")

	reloaded, err := svc.GetGuest(ctx(), g.ID)
	require.NoError(t, err)
	assert.Nil(t, reloaded.Email)
}

func TestPatchGuest_NotFound(t *testing.T) {
	svc, _ := newService(t)
	_, err := svc.PatchGuest(ctx(), "00000000-0000-0000-0000-000000000000", parties.PatchGuestPayload{
		FullName: pointerutil.String("x"),
	})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestPatchGuest_MovesToAnotherParty(t *testing.T) {
	svc, _ := newService(t)
	a := createPartyT(t, svc, digitalPartyInput())
	b := createPartyT(t, svc, digitalPartyInput())
	g := addGuestT(t, svc, a.ID, parties.CreateGuestPayload{FullName: "Mover"})

	updated, err := svc.PatchGuest(ctx(), g.ID, parties.PatchGuestPayload{PartyID: pointerutil.String(b.ID)})
	require.NoError(t, err)
	assert.Equal(t, b.ID, updated.PartyID, "guest should belong to the new party")

	reloaded, err := svc.GetGuest(ctx(), g.ID)
	require.NoError(t, err)
	assert.Equal(t, b.ID, reloaded.PartyID)
}

func TestPatchGuest_MoveArrivesNonPrimaryAndRepairsSource(t *testing.T) {
	svc, db := newService(t)
	a := createPartyT(t, svc, digitalPartyInput())
	b := createPartyT(t, svc, digitalPartyInput())
	// A has a primary plus another guest; B has its own primary.
	mover := addGuestT(t, svc, a.ID, parties.CreateGuestPayload{FullName: "A Primary", IsPrimary: true})
	aOther := addGuestT(t, svc, a.ID, parties.CreateGuestPayload{FullName: "A Other"})
	bPrimary := addGuestT(t, svc, b.ID, parties.CreateGuestPayload{FullName: "B Primary", IsPrimary: true})

	// Moving A's primary into B lands the mover there as a non-primary (B keeps its
	// own primary), and A promotes its oldest remaining guest so it still has one.
	_, err := svc.PatchGuest(ctx(), mover.ID, parties.PatchGuestPayload{PartyID: pointerutil.String(b.ID)})
	require.NoError(t, err)

	reMover, err := svc.GetGuest(ctx(), mover.ID)
	require.NoError(t, err)
	assert.Equal(t, b.ID, reMover.PartyID)
	assert.False(t, reMover.IsPrimary, "a moved guest arrives non-primary")

	assert.Equal(t, 1, countPrimaries(t, db, b.ID))
	reBPrimary, err := svc.GetGuest(ctx(), bPrimary.ID)
	require.NoError(t, err)
	assert.True(t, reBPrimary.IsPrimary, "destination keeps its own primary")

	assert.Equal(t, 1, countPrimaries(t, db, a.ID))
	reAOther, err := svc.GetGuest(ctx(), aOther.ID)
	require.NoError(t, err)
	assert.True(t, reAOther.IsPrimary, "the source promotes its remaining guest")
}

func TestPatchGuest_MovingLastGuestDeletesSourceParty(t *testing.T) {
	svc, _ := newService(t)
	a := createPartyT(t, svc, digitalPartyInput())
	b := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, b.ID, parties.CreateGuestPayload{FullName: "B Primary", IsPrimary: true})
	mover := addGuestT(t, svc, a.ID, parties.CreateGuestPayload{FullName: "A Only", IsPrimary: true})

	// Moving A's only guest into B empties A, so A is deleted, never left behind.
	_, err := svc.PatchGuest(ctx(), mover.ID, parties.PatchGuestPayload{PartyID: pointerutil.String(b.ID)})
	require.NoError(t, err)

	_, err = svc.GetParty(ctx(), a.ID)
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestPatchGuest_UnsettingSolePrimaryRejected(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())
	primary := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Primary", IsPrimary: true})
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Other"})

	// A party must keep a primary: unchecking the only one in place is refused
	// (you promote another guest instead, which demotes this one).
	_, err := svc.PatchGuest(ctx(), primary.ID, parties.PatchGuestPayload{IsPrimary: pointerutil.Bool(false)})
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestPatchGuest_MoveToNonexistentPartyIsValidationError(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())
	g := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Stay"})

	_, err := svc.PatchGuest(ctx(), g.ID, parties.PatchGuestPayload{
		PartyID: pointerutil.String("00000000-0000-0000-0000-000000000000"),
	})
	assertErrCode(t, err, errcodes.CodeValidationError)
}
