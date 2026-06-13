package emails_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// guestNames extracts the full names of the resolved recipients for compact
// assertions.
func guestNames(gs []*models.Guest) []string {
	names := make([]string, 0, len(gs))
	for _, g := range gs {
		names = append(names, g.FullName)
	}
	return names
}

func TestResolveRecipients_EmptyFilterMatchesEveryGuestWithEmail(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	createGuestT(t, f, p.ID, "Bob", guestOpts{}) // no email: skipped

	recipients, skipped, err := f.emails.ResolveRecipients(ctx(), models.RecipientFilter{})
	require.NoError(t, err)
	assert.Equal(t, []string{"Alice"}, guestNames(recipients))
	// Skipped is now the guests themselves (name + party for the double-check
	// list), not just a count.
	assert.Equal(t, []string{"Bob"}, guestNames(skipped))
	// The party rides along for merge-field rendering and display.
	require.NotNil(t, recipients[0].Party)
	assert.Equal(t, "The Smiths", recipients[0].Party.Name)
}

func TestResolveRecipients_FiltersByPartyAttributes(t *testing.T) {
	f := newFixtures(t)
	robins := createPartyT(t, f, "Robin family", partyOpts{
		side: models.SideRobin, relation: models.RelationFamily,
		circle: []string{models.CircleImmediate}, invitationType: models.InvitationPhysical,
	})
	madelines := createPartyT(t, f, "Madeline friends", partyOpts{
		side: models.SideMadeline, relation: models.RelationFriend,
		circle: []string{models.CircleCollege}, invitationType: models.InvitationDigital,
	})
	createGuestT(t, f, robins.ID, "Rae", guestOpts{email: emailOf("rae@example.com")})
	createGuestT(t, f, madelines.ID, "Mia", guestOpts{email: emailOf("mia@example.com")})

	cases := []struct {
		name   string
		filter models.RecipientFilter
		want   []string
	}{
		{"side", models.RecipientFilter{Side: pointerutil.String(models.SideRobin)}, []string{"Rae"}},
		{"relation", models.RecipientFilter{Relation: pointerutil.String(models.RelationFriend)}, []string{"Mia"}},
		{"circle", models.RecipientFilter{Circle: pointerutil.String(models.CircleCollege)}, []string{"Mia"}},
		{"invitation type", models.RecipientFilter{InvitationType: pointerutil.String(models.InvitationPhysical)}, []string{"Rae"}},
		{"combined", models.RecipientFilter{
			Side:     pointerutil.String(models.SideMadeline),
			Relation: pointerutil.String(models.RelationFriend),
		}, []string{"Mia"}},
		{"combined no match", models.RecipientFilter{
			Side:     pointerutil.String(models.SideRobin),
			Relation: pointerutil.String(models.RelationFriend),
		}, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			recipients, _, err := f.emails.ResolveRecipients(ctx(), tc.filter)
			require.NoError(t, err)
			assert.Equal(t, tc.want, guestNames(recipients))
		})
	}
}

func TestResolveRecipients_FiltersByTags(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com"), tags: []string{"Bridal Party"}})
	createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	recipients, _, err := f.emails.ResolveRecipients(ctx(), models.RecipientFilter{
		Tags: []string{"Bridal Party"},
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"Alice"}, guestNames(recipients))
}

func TestResolveRecipients_FiltersByAnyOfMultipleTags(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	// Each guest carries exactly one of the two selected tags; the multi-tag
	// filter is OR (array overlap), so a guest with ANY of them matches.
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com"), tags: []string{"Bridal Party"}})
	createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com"), tags: []string{"Cousin"}})
	createGuestT(t, f, p.ID, "Carol", guestOpts{email: emailOf("carol@example.com"), tags: []string{"UIUC"}})

	recipients, _, err := f.emails.ResolveRecipients(ctx(), models.RecipientFilter{
		Tags: []string{"Bridal Party", "Cousin"},
	})
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"Alice", "Bob"}, guestNames(recipients))
}

func TestResolveRecipients_FiltersByEventAndRSVPStatus(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	// A private event only Alice's party half is invited to: invite the party,
	// then set Alice attending; Bob stays pending.
	event, err := f.events.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Rehearsal Dinner", Date: "2026-10-16", IsPublic: false,
	})
	require.NoError(t, err)
	_, err = f.events.InviteParties(ctx(), event.ID, events.InvitePartiesPayload{PartyIDs: []string{p.ID}})
	require.NoError(t, err)
	_, err = f.events.UpdateRSVPStatus(ctx(), event.ID, alice.ID, events.UpdateEventRSVPPayload{Status: models.RSVPAttending})
	require.NoError(t, err)

	// Event alone matches the invited set.
	recipients, _, err := f.emails.ResolveRecipients(ctx(), models.RecipientFilter{EventID: &event.ID})
	require.NoError(t, err)
	assert.ElementsMatch(t, []string{"Alice", "Bob"}, guestNames(recipients))

	// Event plus status narrows within that event.
	recipients, _, err = f.emails.ResolveRecipients(ctx(), models.RecipientFilter{
		EventID: &event.ID, RSVPStatus: pointerutil.String(models.RSVPAttending),
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"Alice"}, guestNames(recipients))

	// Status alone matches a row in that status on any event.
	recipients, _, err = f.emails.ResolveRecipients(ctx(), models.RecipientFilter{
		RSVPStatus: pointerutil.String(models.RSVPPending),
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"Bob"}, guestNames(recipients))
}

func TestResolveRecipients_FiltersByInfoCollectionStatus(t *testing.T) {
	f := newFixtures(t)
	// A digital party is complete once its primary guest has an email
	// (ADR 0005, derived branch: collection never requested).
	complete := createPartyT(t, f, "Complete party", partyOpts{})
	createGuestT(t, f, complete.ID, "Alice", guestOpts{email: emailOf("alice@example.com"), primary: true})
	// A physical party with no address stays incomplete even though its
	// primary has an email.
	incomplete := createPartyT(t, f, "Incomplete party", partyOpts{invitationType: models.InvitationPhysical})
	createGuestT(t, f, incomplete.ID, "Bob", guestOpts{email: emailOf("bob@example.com"), primary: true})

	recipients, _, err := f.emails.ResolveRecipients(ctx(), models.RecipientFilter{
		InfoCollectionStatus: pointerutil.String(models.StatusComplete),
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"Alice"}, guestNames(recipients))

	recipients, _, err = f.emails.ResolveRecipients(ctx(), models.RecipientFilter{
		InfoCollectionStatus: pointerutil.String(models.StatusIncomplete),
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"Bob"}, guestNames(recipients))
}

func TestResolveRecipients_InfoStatusUsesWholePartyNotJustTheRecipient(t *testing.T) {
	f := newFixtures(t)
	// The completion gate reads the PRIMARY guest's email. Make the primary
	// email-less so the party is incomplete, while a non-primary guest has an
	// email and is the would-be recipient.
	p := createPartyT(t, f, "Mixed party", partyOpts{})
	createGuestT(t, f, p.ID, "Primary No-Email", guestOpts{primary: true})
	createGuestT(t, f, p.ID, "Secondary", guestOpts{email: emailOf("secondary@example.com")})

	recipients, _, err := f.emails.ResolveRecipients(ctx(), models.RecipientFilter{
		InfoCollectionStatus: pointerutil.String(models.StatusIncomplete),
	})
	require.NoError(t, err)
	assert.Equal(t, []string{"Secondary"}, guestNames(recipients))

	recipients, _, err = f.emails.ResolveRecipients(ctx(), models.RecipientFilter{
		InfoCollectionStatus: pointerutil.String(models.StatusComplete),
	})
	require.NoError(t, err)
	assert.Empty(t, recipients)
}

func TestResolveRecipients_BlankEmailCountsAsSkipped(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	// A whitespace-only email cannot be sent to; it counts as skipped, not as
	// a recipient. Inserted directly: the binder would normally trim it away.
	g := createGuestT(t, f, p.ID, "Blank", guestOpts{})
	_, err := f.db.NewUpdate().Model((*models.Guest)(nil)).
		Set("email = ?", "   ").Where("id = ?", g.ID).Exec(ctx())
	require.NoError(t, err)

	recipients, skipped, err := f.emails.ResolveRecipients(ctx(), models.RecipientFilter{})
	require.NoError(t, err)
	assert.Empty(t, recipients)
	assert.Equal(t, []string{"Blank"}, guestNames(skipped))
}
