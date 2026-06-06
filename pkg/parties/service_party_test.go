package parties_test

import (
	"testing"

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

func TestCreateParty_RejectsInvalidEnums(t *testing.T) {
	svc, _ := newService(t)

	in := digitalPartyInput()
	in.Side = "nobody"
	_, err := svc.CreateParty(ctx(), in)
	require.Error(t, err)
	assert.ErrorIs(t, err, parties.ErrValidation)
}

func TestCreateParty_RejectsEmptyName(t *testing.T) {
	svc, _ := newService(t)

	in := digitalPartyInput()
	in.Name = "   "
	_, err := svc.CreateParty(ctx(), in)
	require.Error(t, err)
	assert.ErrorIs(t, err, parties.ErrValidation)
}

func TestCreateParty_DuplicateRSVPCodeConflicts(t *testing.T) {
	svc, _ := newService(t)

	in := digitalPartyInput()
	in.RSVPCode = ptr("KALEL")
	_, err := svc.CreateParty(ctx(), in)
	require.NoError(t, err)

	// A second party with the same RSVP code must conflict.
	in2 := digitalPartyInput()
	in2.RSVPCode = ptr("KALEL")
	_, err = svc.CreateParty(ctx(), in2)
	require.Error(t, err)
	assert.ErrorIs(t, err, parties.ErrConflict)
}

func TestCreateParty_AllowsMultipleNullRSVPCodes(t *testing.T) {
	svc, _ := newService(t)

	// The partial unique index must allow many parties with no RSVP code.
	createPartyT(t, svc, digitalPartyInput())
	createPartyT(t, svc, digitalPartyInput())
}

func TestCreateParty_NormalizesAddressBlanksToNull(t *testing.T) {
	svc, _ := newService(t)

	in := physicalPartyInput()
	in.AddressLine1 = ptr("   ") // whitespace should normalize to NULL
	p := createPartyT(t, svc, in)

	assert.Nil(t, p.AddressLine1, "blank address should be stored as null")
}

func TestGetParty_NotFound(t *testing.T) {
	svc, _ := newService(t)

	_, err := svc.GetParty(ctx(), "00000000-0000-0000-0000-000000000000")
	assert.ErrorIs(t, err, parties.ErrNotFound)
}

func TestUpdateParty_DoesNotTouchCollectionFlags(t *testing.T) {
	svc, _ := newService(t)

	// Mark a party complete (sets requested+confirmed) then edit a field. The
	// edit must not reset the collection flags (ADR 0005).
	p := createPartyT(t, svc, physicalPartyInput())
	addGuestT(t, svc, p.ID, parties.CreateGuestInput{FullName: "Pat Jones", Email: ptr("pat@example.com"), IsPrimary: true})
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
	a.RSVPCode = ptr("PEPPER")
	createPartyT(t, svc, a)

	b := createPartyT(t, svc, digitalPartyInput())

	// Updating b to reuse a's code must conflict.
	_, err := svc.UpdateParty(ctx(), b.ID, parties.UpdatePartyInput{
		Name:           b.Name,
		Side:           b.Side,
		Relation:       b.Relation,
		Circle:         b.Circle,
		InvitationType: b.InvitationType,
		RSVPCode:       ptr("PEPPER"),
	})
	require.Error(t, err)
	assert.ErrorIs(t, err, parties.ErrConflict)
}

func TestUpdateParty_NotFound(t *testing.T) {
	svc, _ := newService(t)

	_, err := svc.UpdateParty(ctx(), "00000000-0000-0000-0000-000000000000", parties.UpdatePartyInput{
		Name:           "x",
		Side:           parties.SideRobin,
		Relation:       parties.RelationFriend,
		InvitationType: parties.InvitationDigital,
	})
	assert.ErrorIs(t, err, parties.ErrNotFound)
}

func TestDeleteParty_CascadesGuests(t *testing.T) {
	svc, _ := newService(t)

	p := createPartyT(t, svc, digitalPartyInput())
	g := addGuestT(t, svc, p.ID, parties.CreateGuestInput{FullName: "Solo Guest", IsPrimary: true})

	require.NoError(t, svc.DeleteParty(ctx(), p.ID))

	// The party is gone.
	_, err := svc.GetParty(ctx(), p.ID)
	require.ErrorIs(t, err, parties.ErrNotFound)
	// And its guest was removed by the FK cascade.
	_, err = svc.GetGuest(ctx(), g.ID)
	require.ErrorIs(t, err, parties.ErrNotFound)
}

func TestDeleteParty_NotFound(t *testing.T) {
	svc, _ := newService(t)
	err := svc.DeleteParty(ctx(), "00000000-0000-0000-0000-000000000000")
	assert.ErrorIs(t, err, parties.ErrNotFound)
}
