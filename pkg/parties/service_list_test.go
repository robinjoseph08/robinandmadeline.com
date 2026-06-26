package parties_test

import (
	"strings"
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

// partyNames returns the party names in their listed order, for asserting sorts.
func partyNames(ps []*models.Party) []string {
	names := make([]string, len(ps))
	for i, p := range ps {
		names[i] = p.Name
	}
	return names
}

// guestNames returns the guest full names in their listed order, for asserting
// sorts.
func guestNames(guests []*models.Guest) []string {
	names := make([]string, len(guests))
	for i, g := range guests {
		names[i] = g.FullName
	}
	return names
}

// sortPartyInput is a minimal valid digital party with the given name and side,
// for sort tests that need parties whose names and sides order differently from
// their creation order (so single-field and multi-level sorts are distinguishable).
func sortPartyInput(name, side string) parties.CreatePartyPayload {
	in := digitalPartyInput()
	in.Name = name
	in.Side = side
	return in
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
	// Created out of display order so the assertions prove the load applies the
	// canonical within-party order rather than echoing insert order: a child
	// first, then two adults, then the primary last.
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Kid", IsChild: true})
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Adult1"})
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Adult2"})
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Primary", IsPrimary: true})

	// Primary first, then the other adults in creation order, then the child
	// last, never heap order, so the admin grid does not reshuffle between loads.
	want := []string{"Primary", "Adult1", "Adult2", "Kid"}

	got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{})
	require.NoError(t, err)
	require.Len(t, got, 1)
	require.Len(t, got[0].Guests, 4, "list should eager-load guests")
	assert.Equal(t, want, guestNames(got[0].Guests))

	// The single-party load (the admin party detail page) orders the same way.
	reloaded, err := svc.GetParty(ctx(), p.ID)
	require.NoError(t, err)
	require.Len(t, reloaded.Guests, 4)
	assert.Equal(t, want, guestNames(reloaded.Guests))
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
		FullName: "Child B", IsChild: true, PlaceholderText: pointerutil.String("Child B"), IsPrimary: true,
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
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Tags: []string{"Bridal Party"}})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID])
	})
	t.Run("tags any-of (OR across multiple tags)", func(t *testing.T) {
		// gb carries neither tag; ga carries "UIUC". The multi-tag filter is OR,
		// so a guest with ANY of the selected tags matches.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Tags: []string{"UIUC", "Groomsman"}})
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
		// The filter is derived from placeholder_text: true matches guests whose
		// descriptor is set, false those where it is NULL.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{IsPlaceholder: pointerutil.Bool(true)})
		require.NoError(t, err)
		ids := guestIDs(got)
		assert.True(t, ids[gb.ID])
		assert.False(t, ids[ga.ID])

		got, _, err = svc.ListGuests(ctx(), parties.ListGuestsQuery{IsPlaceholder: pointerutil.Bool(false)})
		require.NoError(t, err)
		ids = guestIDs(got)
		assert.True(t, ids[ga.ID])
		assert.False(t, ids[gb.ID])
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

// TestListGuests_SearchMatchesFormattedPhone proves the phone clause is gated on
// the term actually looking like a phone number: a query made only of digits and
// common phone formatting (with at least 3 digits) matches a number stored as
// canonical E.164, tolerating punctuation, while any term carrying a letter or
// fewer than 3 digits never touches phones. This keeps a name/email/address
// search that happens to include a digit from matching every phone-bearing guest.
func TestListGuests_SearchMatchesFormattedPhone(t *testing.T) {
	svc, _ := newService(t)
	p := createPartyT(t, svc, digitalPartyInput())
	withPhone := addGuestT(t, svc, p.ID, parties.CreateGuestPayload{
		FullName: "Quinn", Phone: pointerutil.String("+14155552671"),
	})

	t.Run("formatted query matches stored E.164", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("(415) 555-2671")})
		require.NoError(t, err)
		assert.True(t, guestIDs(got)[withPhone.ID], "a formatted phone query finds the E.164 number")
	})
	t.Run("digit-only fragment of 3+ digits matches the phone", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("2671")})
		require.NoError(t, err)
		assert.True(t, guestIDs(got)[withPhone.ID], "the last four digits still find the stored number")
	})
	t.Run("a 3-digit fragment is exactly at the gate and matches the phone", func(t *testing.T) {
		// "415" strips to 3 digits, the minimum the gate allows, and is a
		// substring of the stored number but of neither the name nor the party.
		// It pins the >=3 boundary from above, so a stricter gate (>=4) would
		// regress here.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("415")})
		require.NoError(t, err)
		assert.True(t, guestIDs(got)[withPhone.ID], "exactly 3 digits is a phone search and finds the number")
	})
	t.Run("text-only query does not match on the phone", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("zzz")})
		require.NoError(t, err)
		assert.False(t, guestIDs(got)[withPhone.ID], "a non-digit query must not match every guest who has a phone")
	})
	t.Run("letters plus an incidental digit do not match the phone", func(t *testing.T) {
		// "Apt 415" strips to "415", a 3-digit substring of the stored number, so
		// the old any-digit trigger would have matched the phone. The letters must
		// gate it out: "Apt 415" overlaps nothing in the guest's name or party.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("Apt 415")})
		require.NoError(t, err)
		assert.False(t, guestIDs(got)[withPhone.ID], "a term containing letters must never match on the phone")
	})
	t.Run("a digit fragment shorter than 3 does not match the phone", func(t *testing.T) {
		// "1" is a digit of the stored number, but a lone digit is far too broad to
		// be a phone search, so the minimum-3-digits gate keeps it phone-free.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("1")})
		require.NoError(t, err)
		assert.False(t, guestIDs(got)[withPhone.ID], "fewer than 3 digits must not match on the phone")
	})
	t.Run("a 2-digit fragment just under the gate does not match the phone", func(t *testing.T) {
		// "26" strips to 2 digits, one short of the gate, and is a substring of the
		// stored number. It pins the >=3 boundary from below, so a looser gate
		// (>=2) would wrongly match the phone here.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Search: pointerutil.String("26")})
		require.NoError(t, err)
		assert.False(t, guestIDs(got)[withPhone.ID], "2 digits is under the gate and must not match on the phone")
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

// TestListParties_Sort covers the multi-level party sort. Parties are created out
// of alphabetical, side, and creation order so single-field and multi-level
// sorts each produce a visibly distinct order; "alice" is lowercase so the
// asserted order is alphabetical regardless of case. (These assert the resulting
// order, not the LOWER mechanism: the dev DB's locale collation already folds
// case, so dropping LOWER would not change the order here. See partySortExpr.)
func TestListParties_Sort(t *testing.T) {
	svc, _ := newService(t)

	// Created in this order: Bob (robin), alice (madeline), Charlie (madeline).
	bob := createPartyT(t, svc, sortPartyInput("Bob", models.SideRobin))
	alice := createPartyT(t, svc, sortPartyInput("alice", models.SideMadeline))
	charlie := createPartyT(t, svc, sortPartyInput("Charlie", models.SideMadeline))

	t.Run("name asc sorts A-Z", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{Sort: "name:asc"})
		require.NoError(t, err)
		assert.Equal(t, []string{"alice", "Bob", "Charlie"}, partyNames(got))
	})
	t.Run("name desc is Z-A", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{Sort: "name:desc"})
		require.NoError(t, err)
		assert.Equal(t, []string{"Charlie", "Bob", "alice"}, partyNames(got))
	})
	t.Run("date_added desc is newest first", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{Sort: "date_added:desc"})
		require.NoError(t, err)
		assert.Equal(t, []string{charlie.Name, alice.Name, bob.Name}, partyNames(got))
	})
	t.Run("side then name groups by side, sorts by name within", func(t *testing.T) {
		// side asc puts madeline (m < r) before robin; within each side, name asc.
		// This differs from name-only (which would interleave Bob between alice and
		// Charlie), proving the second level is honored.
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{Sort: "side:asc,name:asc"})
		require.NoError(t, err)
		assert.Equal(t, []string{"alice", "Charlie", "Bob"}, partyNames(got))
	})
	t.Run("empty sort is the builtin default: creation order, oldest first", func(t *testing.T) {
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{})
		require.NoError(t, err)
		assert.Equal(t, []string{bob.Name, alice.Name, charlie.Name}, partyNames(got))
	})
	t.Run("sort composes with a filter", func(t *testing.T) {
		// Narrow to madeline parties, then sort by name: the where clause and the
		// order by coexist.
		got, _, err := svc.ListParties(ctx(), parties.ListPartiesQuery{
			Side: pointerutil.String(models.SideMadeline),
			Sort: "name:asc",
		})
		require.NoError(t, err)
		assert.Equal(t, []string{"alice", "Charlie"}, partyNames(got))
	})
}

// TestListGuests_Sort covers the multi-level guest sort, including sorting by the
// owning party (a correlated subquery) and a party-then-name multi-level sort.
func TestListGuests_Sort(t *testing.T) {
	svc, _ := newService(t)

	// Apple Party (robin) holds Charlie then alice; Zebra Party (madeline) holds
	// Bob. The party subtests below pin the multi-level ordering (primary key is
	// the owning party), not the LOWER in the party-name subquery specifically,
	// which the dev DB's locale collation makes redundant here.
	apple := createPartyT(t, svc, sortPartyInput("Apple Party", models.SideRobin))
	zebra := createPartyT(t, svc, sortPartyInput("Zebra Party", models.SideMadeline))

	// Created in this order: Charlie, then alice, then Bob.
	charlie := addGuestT(t, svc, apple.ID, parties.CreateGuestPayload{FullName: "Charlie", IsPrimary: true})
	alice := addGuestT(t, svc, apple.ID, parties.CreateGuestPayload{FullName: "alice"})
	bob := addGuestT(t, svc, zebra.ID, parties.CreateGuestPayload{FullName: "Bob", IsPrimary: true})

	t.Run("name asc sorts A-Z", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Sort: "name:asc"})
		require.NoError(t, err)
		assert.Equal(t, []string{"alice", "Bob", "Charlie"}, guestNames(got))
	})
	t.Run("name desc is Z-A", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Sort: "name:desc"})
		require.NoError(t, err)
		assert.Equal(t, []string{"Charlie", "Bob", "alice"}, guestNames(got))
	})
	t.Run("party then name groups by owning party, sorts by name within", func(t *testing.T) {
		// Apple (a < z) before Zebra; within Apple, name asc gives alice, Charlie.
		// Differs from name-only ([alice, Bob, Charlie]), proving the primary key is
		// the owning party's name and the guest name is the secondary level.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Sort: "party:asc,name:asc"})
		require.NoError(t, err)
		assert.Equal(t, []string{"alice", "Charlie", "Bob"}, guestNames(got))
	})
	t.Run("side then name sorts by the owning party's side via subquery", func(t *testing.T) {
		// Guest side is a party-level field read through a correlated subquery (not
		// the joined relation alias). side asc puts madeline (Bob, in Zebra) before
		// robin (alice, Charlie, in apple), then name asc within. Pins the subquery
		// shape for guest party-level sorts.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Sort: "side:asc,name:asc"})
		require.NoError(t, err)
		assert.Equal(t, []string{"Bob", "alice", "Charlie"}, guestNames(got))
	})
	t.Run("date_added desc is newest first", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{Sort: "date_added:desc"})
		require.NoError(t, err)
		assert.Equal(t, []string{bob.FullName, alice.FullName, charlie.FullName}, guestNames(got))
	})
	t.Run("empty sort is the builtin default: creation order, oldest first", func(t *testing.T) {
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{})
		require.NoError(t, err)
		assert.Equal(t, []string{charlie.FullName, alice.FullName, bob.FullName}, guestNames(got))
	})
	t.Run("sort composes with a filter", func(t *testing.T) {
		// Narrow to Apple Party, then sort by name: the where clause and the order
		// by coexist.
		got, _, err := svc.ListGuests(ctx(), parties.ListGuestsQuery{
			PartyID: pointerutil.String(apple.ID),
			Sort:    "name:asc",
		})
		require.NoError(t, err)
		assert.Equal(t, []string{"alice", "Charlie"}, guestNames(got))
	})
}

func TestListTags_DistinctSortedCaseInsensitiveAcrossParties(t *testing.T) {
	svc, _ := newService(t)

	// Two parties whose guests' tags overlap: "Cousin" appears in both parties,
	// and "VIP"/"vip" differ only in case. Both must collapse to a single entry.
	p1 := createPartyT(t, svc, digitalPartyInput())
	jones := digitalPartyInput()
	jones.Name = "The Joneses"
	p2 := createPartyT(t, svc, jones)
	addGuestT(t, svc, p1.ID, parties.CreateGuestPayload{FullName: "Alice", Tags: []string{"Cousin", "VIP"}})
	addGuestT(t, svc, p1.ID, parties.CreateGuestPayload{FullName: "Bob", Tags: []string{"Bridal Party"}})
	addGuestT(t, svc, p2.ID, parties.CreateGuestPayload{FullName: "Carol", Tags: []string{"cousin", "vip"}})

	tags, err := svc.ListTags(ctx())
	require.NoError(t, err)

	// Distinct case-insensitively (three tags, not five) and sorted. Compare on
	// lower case so the assertion does not depend on which casing the database's
	// collation keeps as the survivor of a "VIP"/"vip" collision.
	lowered := make([]string, len(tags))
	for i, tag := range tags {
		lowered[i] = strings.ToLower(tag)
	}
	assert.Equal(t, []string{"bridal party", "cousin", "vip"}, lowered)
}

func TestListTags_EmptyWhenNoGuestHasTags(t *testing.T) {
	svc, _ := newService(t)

	// A party whose sole guest carries no tags: the vocabulary is empty, and the
	// result is a non-nil empty slice so the envelope serializes items as [].
	p := createPartyT(t, svc, digitalPartyInput())
	addGuestT(t, svc, p.ID, parties.CreateGuestPayload{FullName: "Alice"})

	tags, err := svc.ListTags(ctx())
	require.NoError(t, err)
	require.NotNil(t, tags)
	assert.Empty(t, tags)
}
