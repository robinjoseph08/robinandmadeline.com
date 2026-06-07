package parties_test

import (
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/parties"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func partyIDs(ps []*models.Party) map[string]bool {
	ids := make(map[string]bool, len(ps))
	for _, p := range ps {
		ids[p.ID] = true
	}
	return ids
}

func guestIDs(guests []*models.Guest) map[string]bool {
	ids := make(map[string]bool, len(guests))
	for _, g := range guests {
		ids[g.ID] = true
	}
	return ids
}

func TestListParties_FiltersBySideRelationCircleInvitation(t *testing.T) {
	svc, _ := newService(t)

	// robin / friend / College / digital
	a := createPartyT(t, svc, parties.CreatePartyPayload{
		Name: "A", Side: models.SideRobin, Relation: models.RelationFriend,
		Circle: []string{"College", "Work"}, InvitationType: models.InvitationDigital,
	})
	// madeline / family / Immediate / physical
	b := createPartyT(t, svc, parties.CreatePartyPayload{
		Name: "B", Side: models.SideMadeline, Relation: models.RelationFamily,
		Circle: []string{"Immediate"}, InvitationType: models.InvitationPhysical,
	})

	t.Run("side", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{Side: ptr(models.SideRobin)})
		require.NoError(t, err)
		ids := partyIDs(got)
		assert.True(t, ids[a.ID])
		assert.False(t, ids[b.ID])
	})
	t.Run("relation", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{Relation: ptr(models.RelationFamily)})
		require.NoError(t, err)
		ids := partyIDs(got)
		assert.True(t, ids[b.ID])
		assert.False(t, ids[a.ID])
	})
	t.Run("circle containment", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{Circle: ptr("Work")})
		require.NoError(t, err)
		ids := partyIDs(got)
		assert.True(t, ids[a.ID], "circle filter should match an element of the array")
		assert.False(t, ids[b.ID])
	})
	t.Run("invitation_type", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{InvitationType: ptr(models.InvitationPhysical)})
		require.NoError(t, err)
		ids := partyIDs(got)
		assert.True(t, ids[b.ID])
		assert.False(t, ids[a.ID])
	})
}

func TestListParties_FilterByRequested(t *testing.T) {
	svc, _ := newService(t)

	requested := createPartyT(t, svc, digitalPartyInput())
	_, err := svc.RequestInfo(ctx(), requested.ID)
	require.NoError(t, err)
	notRequested := createPartyT(t, svc, digitalPartyInput())

	got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{InfoCollectionRequested: ptr(true)})
	require.NoError(t, err)
	ids := partyIDs(got)
	assert.True(t, ids[requested.ID])
	assert.False(t, ids[notRequested.ID])
}

func TestListParties_FilterByStatus_ComputedInGo(t *testing.T) {
	svc, _ := newService(t)

	// complete: digital party with a primary email (derived complete).
	complete := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, complete.ID, parties.CreateGuestPayload{FullName: "C", Email: ptr("c@example.com"), IsPrimary: true})

	// incomplete: digital party whose primary has no email.
	incomplete := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, incomplete.ID, parties.CreateGuestPayload{FullName: "I", IsPrimary: true})

	t.Run("complete", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{InfoCollectionStatus: ptr(models.StatusComplete)})
		require.NoError(t, err)
		ids := partyIDs(got)
		assert.True(t, ids[complete.ID])
		assert.False(t, ids[incomplete.ID])
	})
	t.Run("incomplete", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{InfoCollectionStatus: ptr(models.StatusIncomplete)})
		require.NoError(t, err)
		ids := partyIDs(got)
		assert.True(t, ids[incomplete.ID])
		assert.False(t, ids[complete.ID])
	})
}

func TestListParties_LoadsGuests(t *testing.T) {
	svc, _ := newService(t)

	p := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "G1", IsPrimary: true})
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "G2"})

	got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{})
	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Len(t, got[0].Guests, 2, "list should eager-load guests")
}

func TestListGuests_FlatFilters(t *testing.T) {
	svc, _ := newService(t)

	// Party A: robin / friend / College. Party B: madeline / family / Immediate.
	a := createPartyT(t, svc, parties.CreatePartyPayload{
		Name: "A", Side: models.SideRobin, Relation: models.RelationFriend,
		Circle: []string{"College"}, InvitationType: models.InvitationDigital,
	})
	b := createPartyT(t, svc, parties.CreatePartyPayload{
		Name: "B", Side: models.SideMadeline, Relation: models.RelationFamily,
		Circle: []string{"Immediate"}, InvitationType: models.InvitationDigital,
	})

	// Guest in A: bridal party role, drinking adult.
	ga := addGuestT(t, svc, a.ID, parties.CreateGuestPayload{
		FullName: "Adult A", Roles: []string{"Bridal Party", "UIUC"}, IsDrinking: true, IsPrimary: true,
	})
	// Guest in B: a child placeholder, not drinking.
	gb := addGuestT(t, svc, b.ID, parties.CreateGuestPayload{
		FullName: "Child B", IsChild: true, IsPlaceholder: true, IsPrimary: true,
	})

	t.Run("side (party-level)", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Side: ptr(models.SideRobin)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID])
	})
	t.Run("relation (party-level)", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Relation: ptr(models.RelationFamily)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[gb.ID])
		assert.False(t, ids[ga.ID])
	})
	t.Run("circle (party-level)", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Circle: ptr("College")})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID])
	})
	t.Run("roles containment", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Roles: ptr("Bridal Party")})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID])
	})
	t.Run("is_drinking", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{IsDrinking: ptr(true)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID])
	})
	t.Run("is_child", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{IsChild: ptr(true)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[gb.ID])
		assert.False(t, ids[ga.ID])
	})
	t.Run("is_placeholder", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{IsPlaceholder: ptr(true)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[gb.ID])
		assert.False(t, ids[ga.ID])
	})
	t.Run("combined party + guest predicates", func(t *testing.T) {
		// madeline side AND is_child should match only the child in B.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Side: ptr(models.SideMadeline), IsChild: ptr(true)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[gb.ID])
		assert.False(t, ids[ga.ID])
	})
}
