package emails_test

import (
	"testing"
	"time"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSendTest_EnqueuesAnIsTestSendAddressedToTheInboxesRenderedFromFirstGuest(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	// Alice is the first matching guest (created first), so she is the render
	// source. Bob exists too but is never the render guest.
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	svc := f.emails.WithTestSend([]string{
		"Robin <robin@example.com>", "Madeline <madeline@example.com>",
	})

	resp, err := svc.SendTest(ctx(), emails.TestEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Your code is {{rsvp_code}}; rsvp {{rsvp_link}}",
	})
	require.NoError(t, err)
	require.NotEmpty(t, resp.SendID)
	assert.Equal(t, 2, resp.Queued)

	// The send is flagged a test and snapshots the draft like any real send.
	send, err := loadSendT(t, f, resp.SendID)
	require.NoError(t, err)
	assert.True(t, send.IsTest)
	assert.Equal(t, "Hi {{guest_name}}", send.Subject)
	assert.Equal(t, testSentBy, send.SentBy)

	// One queued row per test inbox, each addressed to the inbox but rendering
	// from the first matching guest (so the worker sends real copy to the
	// couple's inboxes).
	rows := recipientRowsForSend(t, f.db, resp.SendID)
	require.Len(t, rows, 2)
	addrs := make([]string, 0, 2)
	for _, r := range rows {
		addrs = append(addrs, r.EmailAddress)
		assert.Equal(t, alice.ID, r.GuestID)
		assert.Equal(t, models.EmailQueued, r.Status)
		// Not yet dispatched: the worker stamps attempted_at, not SendTest.
		assert.Nil(t, r.AttemptedAt)
	}
	assert.ElementsMatch(t, []string{"Robin <robin@example.com>", "Madeline <madeline@example.com>"}, addrs)
}

func TestSendTest_RendersFromAGuestWithoutAnEmail(t *testing.T) {
	f := newFixtures(t)
	// The only matching guest has no email. A real send would skip her, but a
	// test send addresses the inbox (not the guest), so she still renders a
	// fine test from her merge fields.
	p := createPartyT(t, f, "The Smiths", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	noEmail := createGuestT(t, f, p.ID, "Alice", guestOpts{})

	svc := f.emails.WithTestSend([]string{"robin@example.com"})
	resp, err := svc.SendTest(ctx(), emails.TestEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Code {{rsvp_code}}",
	})
	require.NoError(t, err)

	rows := recipientRowsForSend(t, f.db, resp.SendID)
	require.Len(t, rows, 1)
	assert.Equal(t, noEmail.ID, rows[0].GuestID)
	assert.Equal(t, "robin@example.com", rows[0].EmailAddress)
}

func TestSendTest_UsesFilterEventForEventMergeFields(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	event, err := f.events.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Reception", Date: "2026-10-17", IsPublic: true,
	})
	require.NoError(t, err)

	svc := f.emails.WithTestSend([]string{"robin@example.com"})
	// An event in the filter drives the event merge fields, so the validation
	// passes and the send is created.
	resp, err := svc.SendTest(ctx(), emails.TestEmailPayload{
		Subject: "About {{event_name}}",
		Body:    "On {{event_date}}",
		Filter:  models.RecipientFilter{EventID: &event.ID},
	})
	require.NoError(t, err)

	send, err := loadSendT(t, f, resp.SendID)
	require.NoError(t, err)
	require.NotNil(t, send.RecipientFilter.EventID)
	assert.Equal(t, event.ID, *send.RecipientFilter.EventID)
}

func TestSendTest_CountsAgainstTheDailyBudgetOnceDispatched(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	svc := f.emails.WithTestSend([]string{"robin@example.com", "madeline@example.com"})
	resp, err := svc.SendTest(ctx(), emails.TestEmailPayload{Subject: "Hi", Body: "Body"})
	require.NoError(t, err)

	// The test send's rows are real queued rows; once the worker stamps their
	// attempted_at they count against today's budget exactly like a real send.
	rows := recipientRowsForSend(t, f.db, resp.SendID)
	for _, r := range rows {
		setAttemptedAt(t, f, r.ID, time.Now().UTC())
	}
	preview, err := f.emails.Preview(ctx(), emails.PreviewEmailPayload{Subject: "s", Body: "b"})
	require.NoError(t, err)
	assert.Equal(t, 2, preview.DailySendsUsed)
}

func TestSendTest_NoConfiguredRecipientsIs422(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	svc := f.emails.WithTestSend(nil)

	_, err := svc.SendTest(ctx(), emails.TestEmailPayload{Subject: "s", Body: "b"})
	assertErrCode(t, err, errcodes.CodeValidationError)
	// Nothing was enqueued.
	assertNoSends(t, f)
}

func TestSendTest_MailgunNotConfiguredIs422(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	// A service that never had WithTestSend called (Mailgun off).
	_, err := f.emails.SendTest(ctx(), emails.TestEmailPayload{Subject: "s", Body: "b"})
	assertErrCode(t, err, errcodes.CodeValidationError)
	assertNoSends(t, f)
}

func TestSendTest_NoGuestsMatchTheFilterIs422(t *testing.T) {
	f := newFixtures(t)
	// No guests at all: there is no real guest to render the test from.
	svc := f.emails.WithTestSend([]string{"robin@example.com"})

	_, err := svc.SendTest(ctx(), emails.TestEmailPayload{Subject: "s", Body: "b"})
	assertErrCode(t, err, errcodes.CodeValidationError)
	assertNoSends(t, f)
}

func TestSendTest_HardFailsWhenEventFieldUsedButNoEventSelected(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	svc := f.emails.WithTestSend([]string{"robin@example.com"})

	// A test is a real send, so it cannot dispatch a blank merge field either:
	// {{event_name}} with no event filter renders empty and is refused.
	_, err := svc.SendTest(ctx(), emails.TestEmailPayload{
		Subject: "About {{event_name}}",
		Body:    "Body",
	})
	assertErrCode(t, err, errcodes.CodeValidationError)
	assertNoSends(t, f)
}

func TestSendTest_HardFailsWhenRSVPCodeUsedButRenderGuestLacksOne(t *testing.T) {
	f := newFixtures(t)
	// The render guest's party has no RSVP code, so {{rsvp_code}} renders empty.
	noCode := createPartyT(t, f, "No code", partyOpts{})
	bob := createGuestT(t, f, noCode.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})
	_, err := f.db.NewUpdate().Model((*models.Party)(nil)).
		Set("rsvp_code = NULL").Where("id = ?", bob.PartyID).Exec(ctx())
	require.NoError(t, err)
	svc := f.emails.WithTestSend([]string{"robin@example.com"})

	_, err = svc.SendTest(ctx(), emails.TestEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Your code is {{rsvp_code}}",
	})
	assertErrCode(t, err, errcodes.CodeValidationError)
	assertNoSends(t, f)
}

// assertNoSends asserts no email_sends or email_recipients rows exist, proving a
// rejected test send enqueued nothing.
func assertNoSends(t *testing.T, f fixtures) {
	t.Helper()
	_, total, err := f.emails.ListSends(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, total)
	count, err := f.db.NewSelect().Model((*models.EmailRecipient)(nil)).Count(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, count)
}
