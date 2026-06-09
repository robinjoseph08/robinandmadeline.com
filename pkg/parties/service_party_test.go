package parties_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCreateParty_GeneratesInfoToken(t *testing.T) {
	svc, _ := newService(t)

	p := createPartyT(t, svc, digitalPartyInput())

	assert.NotEmpty(t, p.ID)
	assert.NotEmpty(t, p.InfoToken, "info token should be auto-generated")
	assert.False(t, p.InfoCollectionRequested)
	assert.False(t, p.InfoCollectionConfirmed)
	// Distinct parties get distinct tokens.
	p2 := createPartyT(t, svc, digitalPartyInput())
	assert.NotEqual(t, p.InfoToken, p2.InfoToken)
}

func TestCreateParty_DuplicateRSVPCodeConflicts(t *testing.T) {
	svc, _ := newService(t)

	in := digitalPartyInput()
	in.RSVPCode = pointerutil.String("KALEL")
	_, err := svc.CreateParty(ctx(), in)
	require.NoError(t, err)

	// A second party with the same RSVP code must conflict.
	in2 := digitalPartyInput()
	in2.RSVPCode = pointerutil.String("KALEL")
	_, err = svc.CreateParty(ctx(), in2)
	assertErrCode(t, err, errcodes.CodeConflict)
}

func TestCreateParty_AllowsMultipleNullRSVPCodes(t *testing.T) {
	svc, _ := newService(t)

	// The partial unique index must allow many parties with no RSVP code.
	createPartyT(t, svc, digitalPartyInput())
	createPartyT(t, svc, digitalPartyInput())
}

func TestCreateParty_NilCirclePersistsAsEmptyArray(t *testing.T) {
	svc, _ := newService(t)

	// A direct service call with a nil Circle (bypassing the binder's default:"[]")
	// must still persist '{}', not NULL: the model's BeforeAppendModel hook is the
	// code-path-independent backstop for the NOT NULL text[] column. Reload from
	// the DB so the assertion reflects persisted state.
	in := digitalPartyInput()
	in.Circle = nil
	p := createPartyT(t, svc, in)

	reloaded, err := svc.GetParty(ctx(), p.ID)
	require.NoError(t, err)
	assert.NotNil(t, reloaded.Circle, "nil circle should persist as an empty array, not null")
	assert.Empty(t, reloaded.Circle)
}

func TestCreatePartyWithGuest_CreatesPrimaryFirstGuest(t *testing.T) {
	svc, db := newService(t)

	// The public create path is born with its first guest, who is the primary.
	p, err := svc.CreatePartyWithGuest(ctx(), parties.CreatePartyWithGuestPayload{
		Name:           "The Smiths",
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		InvitationType: models.InvitationDigital,
		Guest:          parties.FirstGuestPayload{FullName: "Pat Smith"},
	})
	require.NoError(t, err)
	assert.NotEmpty(t, p.InfoToken)
	require.Len(t, p.Guests, 1)
	assert.Equal(t, "Pat Smith", p.Guests[0].FullName)
	assert.True(t, p.Guests[0].IsPrimary, "the first guest is the party's primary")
	assert.Equal(t, 1, countPrimaries(t, db, p.ID))

	// Both rows persisted in one transaction.
	reloaded, err := svc.GetParty(ctx(), p.ID)
	require.NoError(t, err)
	require.Len(t, reloaded.Guests, 1)
	assert.True(t, reloaded.Guests[0].IsPrimary)
}

func TestCreatePartyWithGuest_DuplicateRSVPRollsBack(t *testing.T) {
	svc, db := newService(t)

	in := parties.CreatePartyWithGuestPayload{
		Name: "First", Side: models.SideRobin, Relation: models.RelationFriend,
		InvitationType: models.InvitationDigital, RSVPCode: pointerutil.String("KALEL"),
		Guest: parties.FirstGuestPayload{FullName: "A"},
	}
	_, err := svc.CreatePartyWithGuest(ctx(), in)
	require.NoError(t, err)

	// A second party reusing the code conflicts, and the whole transaction rolls
	// back so the failed attempt leaves no orphaned guest behind.
	in2 := in
	in2.Name = "Second"
	in2.Guest = parties.FirstGuestPayload{FullName: "B"}
	_, err = svc.CreatePartyWithGuest(ctx(), in2)
	assertErrCode(t, err, errcodes.CodeConflict)

	n, err := db.NewSelect().Model((*models.Guest)(nil)).Where("full_name = ?", "B").Count(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n, "a rolled-back create leaves no guest behind")
}

func TestGetParty_NotFound(t *testing.T) {
	svc, _ := newService(t)

	_, err := svc.GetParty(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestUpdateParty_DoesNotTouchCollectionFlags(t *testing.T) {
	svc, _ := newService(t)

	// Mark a party complete (sets requested+confirmed) then edit a field. The
	// edit must not reset the collection flags (ADR 0005).
	p := createPartyT(t, svc, physicalPartyInput())
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Pat Jones", Email: pointerutil.String("pat@example.com"), IsPrimary: true})
	line1, city, state, postal, country := fullAddress()
	updatePartyAddress(t, svc, p.ID, line1, city, state, postal, country)

	marked, err := svc.MarkComplete(ctx(), p.ID)
	require.NoError(t, err)
	require.True(t, marked.InfoCollectionRequested)
	require.True(t, marked.InfoCollectionConfirmed)

	// Now edit an unrelated field.
	updated := updatePartyName(t, svc, p.ID, "The Jones Family")
	assert.True(t, updated.InfoCollectionRequested, "edit must not clear requested")
	assert.True(t, updated.InfoCollectionConfirmed, "edit must not clear confirmed")
	assert.Equal(t, "The Jones Family", updated.Name)
}

func TestUpdateParty_DuplicateRSVPCodeConflicts(t *testing.T) {
	svc, _ := newService(t)

	a := digitalPartyInput()
	a.RSVPCode = pointerutil.String("PEPPER")
	createPartyT(t, svc, a)

	b := createPartyT(t, svc, digitalPartyInput())

	// Updating b to reuse a's code must conflict.
	_, err := svc.UpdateParty(ctx(), b.ID, parties.UpdatePartyPayload{
		Name:           b.Name,
		Side:           b.Side,
		Relation:       b.Relation,
		Circle:         b.Circle,
		InvitationType: b.InvitationType,
		RSVPCode:       pointerutil.String("PEPPER"),
	})
	assertErrCode(t, err, errcodes.CodeConflict)
}

func TestUpdateParty_NotFound(t *testing.T) {
	svc, _ := newService(t)

	_, err := svc.UpdateParty(ctx(), "00000000-0000-0000-0000-000000000000", parties.UpdatePartyPayload{
		Name:           "x",
		Side:           models.SideRobin,
		Relation:       models.RelationFriend,
		InvitationType: models.InvitationDigital,
	})
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestDeleteParty_CascadesGuests(t *testing.T) {
	svc, _ := newService(t)

	p := createPartyT(t, svc, digitalPartyInput())
	g := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Solo Guest", IsPrimary: true})

	require.NoError(t, svc.DeleteParty(ctx(), p.ID))

	// The party is gone.
	_, err := svc.GetParty(ctx(), p.ID)
	assertErrCode(t, err, errcodes.CodeNotFound)
	// And its guest was removed by the FK cascade.
	_, err = svc.GetGuest(ctx(), g.ID)
	assertErrCode(t, err, errcodes.CodeNotFound)
}

func TestDeleteParty_NotFound(t *testing.T) {
	svc, _ := newService(t)
	err := svc.DeleteParty(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}
