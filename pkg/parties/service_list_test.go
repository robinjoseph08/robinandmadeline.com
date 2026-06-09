package parties_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
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
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{Side: pointerutil.String(models.SideRobin)})
		require.NoError(t, err)
		ids := partyIDs(got)
		assert.True(t, ids[a.ID])
		assert.False(t, ids[b.ID])
	})
	t.Run("relation", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{Relation: pointerutil.String(models.RelationFamily)})
		require.NoError(t, err)
		ids := partyIDs(got)
		assert.True(t, ids[b.ID])
		assert.False(t, ids[a.ID])
	})
	t.Run("circle containment", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{Circle: pointerutil.String("Work")})
		require.NoError(t, err)
		ids := partyIDs(got)
		assert.True(t, ids[a.ID], "circle filter should match an element of the array")
		assert.False(t, ids[b.ID])
	})
	t.Run("invitation_type", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{InvitationType: pointerutil.String(models.InvitationPhysical)})
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

	got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{InfoCollectionRequested: pointerutil.Bool(true)})
	require.NoError(t, err)
	ids := partyIDs(got)
	assert.True(t, ids[requested.ID])
	assert.False(t, ids[notRequested.ID])
}

func TestListParties_FilterByStatus_ComputedInGo(t *testing.T) {
	svc, _ := newService(t)

	// complete: digital party with a primary email (derived complete).
	complete := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, complete.ID, parties.CreateGuestPayload{FullName: "C", Email: pointerutil.String("c@example.com"), IsPrimary: true})

	// incomplete: digital party whose primary has no email.
	incomplete := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, incomplete.ID, parties.CreateGuestPayload{FullName: "I", IsPrimary: true})

	t.Run("complete", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{InfoCollectionStatus: pointerutil.String(models.StatusComplete)})
		require.NoError(t, err)
		ids := partyIDs(got)
		assert.True(t, ids[complete.ID])
		assert.False(t, ids[incomplete.ID])
	})
	t.Run("incomplete", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{InfoCollectionStatus: pointerutil.String(models.StatusIncomplete)})
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

	// Guest in A: bridal party tag, drinking adult.
	ga := addGuestT(t, svc, a.ID, parties.CreateGuestPayload{
		FullName: "Adult A", Tags: []string{"Bridal Party", "UIUC"}, IsDrinking: true, IsPrimary: true,
	})
	// Guest in B: a child placeholder, not drinking.
	gb := addGuestT(t, svc, b.ID, parties.CreateGuestPayload{
		FullName: "Child B", IsChild: true, IsPlaceholder: true, IsPrimary: true,
	})

	t.Run("side (party-level)", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Side: pointerutil.String(models.SideRobin)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID])
	})
	t.Run("relation (party-level)", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Relation: pointerutil.String(models.RelationFamily)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[gb.ID])
		assert.False(t, ids[ga.ID])
	})
	t.Run("circle (party-level)", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Circle: pointerutil.String("College")})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID])
	})
	t.Run("tags containment", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Tags: pointerutil.String("Bridal Party")})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID])
	})
	t.Run("is_drinking", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{IsDrinking: pointerutil.Bool(true)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID])
	})
	t.Run("is_child", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{IsChild: pointerutil.Bool(true)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[gb.ID])
		assert.False(t, ids[ga.ID])
	})
	t.Run("is_placeholder", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{IsPlaceholder: pointerutil.Bool(true)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[gb.ID])
		assert.False(t, ids[ga.ID])
	})
	t.Run("combined party + guest predicates", func(t *testing.T) {
		// madeline side AND is_child should match only the child in B.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Side: pointerutil.String(models.SideMadeline), IsChild: pointerutil.Bool(true)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[gb.ID])
		assert.False(t, ids[ga.ID])
	})
	t.Run("party_id", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{PartyID: pointerutil.String(a.ID)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID], "the party filter excludes guests of other parties")
	})
}

// TestListGuests_LoadsOwningParty proves the flat guest list eager-loads each
// guest's owning party so the response can surface the party name (a guest has
// no detail page; it is edited in its party's context).
func TestListGuests_LoadsOwningParty(t *testing.T) {
	svc, _ := newService(t)

	a := createPartyT(t, svc, parties.CreatePartyPayload{
		Name: "The Smiths", Side: models.SideRobin, Relation: models.RelationFriend,
		Circle: []string{"College"}, InvitationType: models.InvitationDigital,
	})
	b := createPartyT(t, svc, parties.CreatePartyPayload{
		Name: "The Joneses", Side: models.SideMadeline, Relation: models.RelationFamily,
		Circle: []string{"Immediate"}, InvitationType: models.InvitationDigital,
	})
	addGuestT(t, svc, a.ID, parties.CreateGuestPayload{FullName: "Smith Guest", IsPrimary: true})
	addGuestT(t, svc, b.ID, parties.CreateGuestPayload{FullName: "Jones Guest", IsPrimary: true})

	got, total, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{})
	require.NoError(t, err)
	require.Equal(t, 2, total)
	require.Len(t, got, 2)

	// Each guest's Party relation is populated with the right party name.
	names := map[string]string{}
	for _, g := range got {
		require.NotNil(t, g.Party, "ListGuests should eager-load the owning party")
		names[g.PartyID] = g.Party.Name
	}
	assert.Equal(t, "The Smiths", names[a.ID])
	assert.Equal(t, "The Joneses", names[b.ID])
}
