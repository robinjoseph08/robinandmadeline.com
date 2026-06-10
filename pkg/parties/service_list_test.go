package parties_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
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
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "G3"})

	got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{})
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Len(t, got[0].Guests, 3, "list should eager-load guests")

	// Guests come back in creation order (created_at, id tiebreak), never heap
	// order, so the admin grid does not reshuffle between loads.
	listNames := []string{got[0].Guests[0].FullName, got[0].Guests[1].FullName, got[0].Guests[2].FullName}
	assert.Equal(t, []string{"G1", "G2", "G3"}, listNames)

	// The single-party load orders the same way.
	reloaded, err := svc.GetParty(ctx(), p.ID)
	require.NoError(t, err)
	require.Len(t, reloaded.Guests, 3)
	getNames := []string{reloaded.Guests[0].FullName, reloaded.Guests[1].FullName, reloaded.Guests[2].FullName}
	assert.Equal(t, []string{"G1", "G2", "G3"}, getNames)
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
	t.Run("search by name (case-insensitive)", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("adult")})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID], "Adult A matches a case-insensitive substring of its name")
		assert.False(t, ids[gb.ID])
	})
}

// TestListGuests_SearchMatchesPartyName proves the single search box also matches
// a guest by its owning party's name, not just the guest's own fields.
func TestListGuests_SearchMatchesPartyName(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, parties.CreatePartyPayload{
		Name: "The Hendersons", Side: models.SideRobin, Relation: models.RelationFamily,
		InvitationType: models.InvitationDigital,
	})
	// The guest's own name shares nothing with the search term, so a match can
	// only come from the party name.
	g := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Zoe"})

	got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("henderson")})
	require.NoError(t, err)
	ids := guestIDs(got)
	assert.True(t, ids[g.ID], "a guest matches when its party's name matches the search")
}

// TestListGuests_SearchMatchesFormattedPhone proves the phone search tolerates
// formatting: a query typed with punctuation still finds a number stored as
// canonical E.164, while a text-only query does not match a guest merely because
// it has a phone (the formatting-stripped clause is skipped when the query has no
// digits).
func TestListGuests_SearchMatchesFormattedPhone(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())
	withPhone := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{
		FullName: "Pat", Phone: pointerutil.String("+14155552671"),
	})

	t.Run("formatted query matches stored E.164", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("(415) 555-2671")})
		require.NoError(t, err)
		assert.True(t, guestIDs(got)[withPhone.ID], "a formatted phone query finds the E.164 number")
	})
	t.Run("text-only query does not match on the phone", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("zzz")})
		require.NoError(t, err)
		assert.False(t, guestIDs(got)[withPhone.ID], "a non-digit query must not match every guest who has a phone")
	})
}

// TestListGuests_SearchEscapesLikeWildcards proves a literal "_" or "%" in the
// search term matches itself rather than acting as an ILIKE wildcard: "a_b"
// must not match "axb" (unescaped, "_" matches any character) and "%" must not
// match every guest.
func TestListGuests_SearchEscapesLikeWildcards(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())
	underscore := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "a_b"})
	plain := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "axb"})

	t.Run("underscore is literal", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("a_b")})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[underscore.ID], "the literal a_b guest matches")
		assert.False(t, ids[plain.ID], "an unescaped _ would also match axb")
	})
	t.Run("percent is literal", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("%")})
		require.NoError(t, err)
		assert.Empty(t, got, "an unescaped %% would match every guest")
	})
	t.Run("trailing backslash does not break the pattern", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String(`a\`)})
		require.NoError(t, err)
		assert.Empty(t, got)
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

// TestListGuests_EventAndRSVPStatusFilters covers the #6 guest-list filters:
// an event filter alone matches the event's invited set (the guests holding an
// Event RSVP row for it, ADR 0002); adding a status constrains within that
// event; a status alone matches guests holding a row in that status on any
// event.
func TestListGuests_EventAndRSVPStatusFilters(t *testing.T) {
	svc, db := newService(t)
	eventSvc := events.NewService(db)

	a := createPartyT(t, svc, digitalPartyInput())
	g1 := addGuestT(t, svc, a.ID, parties.CreateGuestPayload{FullName: "Alice"})
	g2 := addGuestT(t, svc, a.ID, parties.CreateGuestPayload{FullName: "Bob"})
	b := createPartyT(t, svc, digitalPartyInput())
	g3 := addGuestT(t, svc, b.ID, parties.CreateGuestPayload{FullName: "Carol"})

	// A public event invites everyone; a private one invites only party A.
	public, err := eventSvc.CreateEvent(ctx(), events.CreateEventPayload{Name: "Reception", Date: "2026-10-17", IsPublic: true})
	require.NoError(t, err)
	private, err := eventSvc.CreateEvent(ctx(), events.CreateEventPayload{Name: "Rehearsal", Date: "2026-10-16"})
	require.NoError(t, err)
	_, err = eventSvc.InviteParties(ctx(), private.ID, events.InvitePartiesPayload{PartyIDs: []string{a.ID}})
	require.NoError(t, err)

	// Alice attends the private event; Carol attends the public one.
	_, err = eventSvc.UpdateRSVPStatus(ctx(), private.ID, g1.ID, events.UpdateEventRSVPPayload{Status: models.RSVPAttending})
	require.NoError(t, err)
	_, err = eventSvc.UpdateRSVPStatus(ctx(), public.ID, g3.ID, events.UpdateEventRSVPPayload{Status: models.RSVPAttending})
	require.NoError(t, err)

	t.Run("event alone matches the invited set", func(t *testing.T) {
		got, total, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{EventID: pointerutil.String(private.ID)})
		require.NoError(t, err)
		assert.Equal(t, 2, total)
		ids := guestIDs(got)
		assert.True(t, ids[g1.ID])
		assert.True(t, ids[g2.ID])
		assert.False(t, ids[g3.ID], "a guest with no row for the event is not invited to it")
	})
	t.Run("event plus status constrains within that event", func(t *testing.T) {
		got, total, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{
			EventID:    pointerutil.String(private.ID),
			RSVPStatus: pointerutil.String(models.RSVPAttending),
		})
		require.NoError(t, err)
		assert.Equal(t, 1, total)
		ids := guestIDs(got)
		assert.True(t, ids[g1.ID])
		assert.False(t, ids[g3.ID], "Carol attends the public event, not this one")
	})
	t.Run("event plus pending", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{
			EventID:    pointerutil.String(private.ID),
			RSVPStatus: pointerutil.String(models.RSVPPending),
		})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.False(t, ids[g1.ID], "Alice already responded")
		assert.True(t, ids[g2.ID])
	})
	t.Run("status alone matches any event", func(t *testing.T) {
		got, total, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{RSVPStatus: pointerutil.String(models.RSVPAttending)})
		require.NoError(t, err)
		assert.Equal(t, 2, total)
		ids := guestIDs(got)
		assert.True(t, ids[g1.ID], "attending the private event")
		assert.True(t, ids[g3.ID], "attending the public event")
		assert.False(t, ids[g2.ID], "pending everywhere")
	})
	t.Run("combines with other guest filters", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{
			PartyID:    pointerutil.String(a.ID),
			RSVPStatus: pointerutil.String(models.RSVPAttending),
		})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[g1.ID])
		assert.False(t, ids[g3.ID], "filtered out by the party filter")
	})
}
