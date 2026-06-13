package emails_test

import (
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSendTest_DispatchesToEveryConfiguredRecipientWithSampleData(t *testing.T) {
	f := newFixtures(t)
	client := newFakeMailgun()
	svc := f.emails.WithTestSend(client, testFrom, []string{
		"Robin <robin@example.com>", "Madeline <madeline@example.com>",
	})

	// A draft that references every emptiable field, with NO event selected and
	// no real recipients: the sample context fills them so the email always
	// renders complete (the item-2 emptiness validation does not gate a test
	// send).
	resp, err := svc.SendTest(ctx(), emails.TestEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Code {{rsvp_code}} for {{event_name}} on {{event_date}}; rsvp {{rsvp_link}}",
	})
	require.NoError(t, err)
	assert.Equal(t, 2, resp.SentTo)

	msgs := client.sentMessages()
	require.Len(t, msgs, 2)
	tos := []string{msgs[0].To, msgs[1].To}
	assert.ElementsMatch(t, []string{"Robin <robin@example.com>", "Madeline <madeline@example.com>"}, tos)

	// Sample data fills the merge fields so nothing renders blank, and the body
	// goes out as both text and shell-wrapped HTML.
	m := msgs[0]
	assert.NotContains(t, m.Subject, "{{")
	assert.NotContains(t, m.Text, "{{")
	assert.NotEmpty(t, m.Text)
	assert.Contains(t, m.HTML, "<!doctype html>")
	assert.NotContains(t, m.HTML, "{{event_name}}")
}

func TestSendTest_UsesFilterEventWhenOneIsSelected(t *testing.T) {
	f := newFixtures(t)
	client := newFakeMailgun()
	svc := f.emails.WithTestSend(client, testFrom, []string{"robin@example.com"})

	event, err := f.events.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Reception", Date: "2026-10-17", IsPublic: true,
	})
	require.NoError(t, err)

	// When a real event is selected in the filter, the test send renders it
	// (rather than the sample event) so the admin previews the real copy.
	_, err = svc.SendTest(ctx(), emails.TestEmailPayload{
		Subject: "About {{event_name}}",
		Body:    "On {{event_date}}",
		Filter:  models.RecipientFilter{EventID: &event.ID},
	})
	require.NoError(t, err)

	msgs := client.sentMessages()
	require.Len(t, msgs, 1)
	assert.Equal(t, "About Reception", msgs[0].Subject)
	assert.Equal(t, "On Saturday, October 17, 2026", msgs[0].Text)
}

func TestSendTest_NoConfiguredRecipientsIs422(t *testing.T) {
	f := newFixtures(t)
	client := newFakeMailgun()
	svc := f.emails.WithTestSend(client, testFrom, nil)

	_, err := svc.SendTest(ctx(), emails.TestEmailPayload{Subject: "s", Body: "b"})
	assertErrCode(t, err, errcodes.CodeValidationError)
	// Nothing was dispatched.
	assert.Empty(t, client.sentMessages())
}

func TestSendTest_MailgunNotConfiguredIs422(t *testing.T) {
	f := newFixtures(t)
	// A service that never had a Mailgun client injected (Mailgun off).
	_, err := f.emails.SendTest(ctx(), emails.TestEmailPayload{Subject: "s", Body: "b"})
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestSendTest_DoesNotCreateRecipientRowsOrTouchTheBudget(t *testing.T) {
	f := newFixtures(t)
	client := newFakeMailgun()
	svc := f.emails.WithTestSend(client, testFrom, []string{"robin@example.com"})

	_, err := svc.SendTest(ctx(), emails.TestEmailPayload{Subject: "Hi {{guest_name}}", Body: "Body"})
	require.NoError(t, err)

	// A test send is ephemeral: no email_sends, no email_recipients, and the
	// daily-budget counter (attempted_at rows) is untouched.
	sends, total, err := f.emails.ListSends(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, total)
	assert.Empty(t, sends)

	var recipientCount int
	recipientCount, err = f.db.NewSelect().Model((*models.EmailRecipient)(nil)).Count(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, recipientCount)
}
