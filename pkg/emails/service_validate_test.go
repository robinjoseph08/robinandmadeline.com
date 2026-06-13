package emails_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestPreview_WarnsWhenEventFieldUsedButNoEventSelected(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	// {{event_name}} with no event in the filter would render empty for everyone.
	resp, err := f.emails.Preview(ctx(), emails.PreviewEmailPayload{
		Subject: "About {{event_name}}",
		Body:    "Body",
	})
	require.NoError(t, err)
	require.Len(t, resp.Warnings, 1)
	assert.Equal(t, "event_name", resp.Warnings[0].Field)
	// The preview is still non-fatal: the rendered sample comes back too.
	assert.Equal(t, "About ", resp.SampleSubject)
}

func TestPreview_NoEventWarningWhenEventSelected(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	event, err := f.events.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Reception", Date: "2026-10-17", IsPublic: true,
	})
	require.NoError(t, err)

	resp, err := f.emails.Preview(ctx(), emails.PreviewEmailPayload{
		Subject: "About {{event_name}}",
		Body:    "Body",
		Filter:  models.RecipientFilter{EventID: &event.ID},
	})
	require.NoError(t, err)
	assert.Empty(t, resp.Warnings)
}

func TestPreview_WarnsWhenRSVPCodeUsedButSomeRecipientsLackOne(t *testing.T) {
	f := newFixtures(t)
	withCode := createPartyT(t, f, "Has code", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	createGuestT(t, f, withCode.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	// A party whose code was cleared: its recipient would get a blank code.
	noCode := createPartyT(t, f, "No code", partyOpts{})
	bob := createGuestT(t, f, noCode.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})
	_, err := f.db.NewUpdate().Model((*models.Party)(nil)).
		Set("rsvp_code = NULL").Where("id = ?", bob.PartyID).Exec(ctx())
	require.NoError(t, err)

	resp, err := f.emails.Preview(ctx(), emails.PreviewEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Your code is {{rsvp_code}}",
	})
	require.NoError(t, err)
	require.Len(t, resp.Warnings, 1)
	assert.Equal(t, "rsvp_code", resp.Warnings[0].Field)
	assert.Contains(t, resp.Warnings[0].Message, "1 of 2 recipients have no RSVP code")
}

func TestPreview_NoRSVPCodeWarningWhenAllRecipientsHaveOne(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	resp, err := f.emails.Preview(ctx(), emails.PreviewEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Your code is {{rsvp_code}}",
	})
	require.NoError(t, err)
	assert.Empty(t, resp.Warnings)
}

func TestCreateSend_HardFailsWhenEventFieldUsedButNoEventSelected(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	// The backstop that makes a blank merge field impossible: even a direct
	// CreateSend call refuses to dispatch a draft that would render empty.
	_, _, err := f.emails.CreateSend(ctx(), emails.SendEmailPayload{
		Subject: "About {{event_name}}",
		Body:    "Body",
	})
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestCreateSend_HardFailsWhenRSVPCodeUsedButRecipientLacksOne(t *testing.T) {
	f := newFixtures(t)
	noCode := createPartyT(t, f, "No code", partyOpts{})
	bob := createGuestT(t, f, noCode.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})
	_, err := f.db.NewUpdate().Model((*models.Party)(nil)).
		Set("rsvp_code = NULL").Where("id = ?", bob.PartyID).Exec(ctx())
	require.NoError(t, err)

	_, _, err = f.emails.CreateSend(ctx(), emails.SendEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Your code is {{rsvp_code}}",
	})
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestCreateSend_SucceedsWhenMergeFieldsResolveForEveryone(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	event, err := f.events.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Reception", Date: "2026-10-17", IsPublic: true,
	})
	require.NoError(t, err)

	// Event selected and every recipient has a code: no blank field, so the
	// send goes through.
	_, _, err = f.emails.CreateSend(ctx(), emails.SendEmailPayload{
		Subject: "About {{event_name}}",
		Body:    "Your code is {{rsvp_code}} for {{event_date}}",
		Filter:  models.RecipientFilter{EventID: &event.ID},
	})
	require.NoError(t, err)
}
