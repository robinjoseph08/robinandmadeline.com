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

func TestPreview_RendersSampleForFirstRecipient(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	createGuestT(t, f, p.ID, "Bob", guestOpts{}) // no email: skipped

	resp, err := f.emails.Preview(ctx(), emails.PreviewEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Party {{party_name}}, code {{rsvp_code}}, info {{info_link}}",
	})
	require.NoError(t, err)

	assert.Equal(t, 1, resp.Total)
	assert.Equal(t, 1, resp.SkippedNoEmail)
	require.Len(t, resp.Recipients, 1)
	assert.Equal(t, "Alice", resp.Recipients[0].GuestName)
	assert.Equal(t, "alice@example.com", resp.Recipients[0].EmailAddress)
	assert.Equal(t, "The Smiths", resp.Recipients[0].PartyName)

	assert.Equal(t, "Alice", resp.SampleGuestName)
	assert.Equal(t, "Hi Alice", resp.SampleSubject)
	assert.Equal(t, "Party The Smiths, code KALEL, info "+testBaseURL+"/i/"+p.InfoToken, resp.SampleBody)
}

func TestPreview_ResolvesEventFieldsFromFilterEvent(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	event, err := f.events.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Reception", Date: "2026-10-17", IsPublic: true,
	})
	require.NoError(t, err)

	resp, err := f.emails.Preview(ctx(), emails.PreviewEmailPayload{
		Subject: "{{event_name}}",
		Body:    "{{event_name}} is on {{event_date}}",
		Filter:  models.RecipientFilter{EventID: &event.ID},
	})
	require.NoError(t, err)
	assert.Equal(t, "Reception", resp.SampleSubject)
	assert.Equal(t, "Reception is on Saturday, October 17, 2026", resp.SampleBody)
}

func TestPreview_NoRecipientsHasEmptySample(t *testing.T) {
	f := newFixtures(t)

	resp, err := f.emails.Preview(ctx(), emails.PreviewEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Body",
	})
	require.NoError(t, err)
	assert.Equal(t, 0, resp.Total)
	assert.Empty(t, resp.Recipients)
	assert.Empty(t, resp.SampleGuestName)
	assert.Empty(t, resp.SampleSubject)
	assert.Empty(t, resp.SampleBody)
}

func TestPreview_ReportsTodaysDailySendBudget(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	bob := createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	rows := recipientsForSend(t, f.db, send.ID)
	// Alice's row was attempted today, Bob's yesterday: only today's attempt
	// counts toward the budget the compose page shows.
	setAttemptedAt(t, f, rows[alice.ID].ID, time.Now().UTC())
	setAttemptedAt(t, f, rows[bob.ID].ID, time.Now().UTC().Add(-25*time.Hour))

	resp, err := f.emails.Preview(ctx(), emails.PreviewEmailPayload{Subject: "s", Body: "b"})
	require.NoError(t, err)
	assert.Equal(t, testDailySendLimit, resp.DailySendLimit)
	assert.Equal(t, 1, resp.DailySendsUsed)
}

func TestPreview_UnlimitedDailyLimitIsReportedAsZero(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	// A non-positive configured limit means unlimited; the response carries it
	// through as zero so the UI knows there is nothing to warn about.
	unlimited := emails.NewService(f.db, testBaseURL, testSentBy, 0)
	resp, err := unlimited.Preview(ctx(), emails.PreviewEmailPayload{Subject: "s", Body: "b"})
	require.NoError(t, err)
	assert.Equal(t, 0, resp.DailySendLimit)
}

func TestCreateSend_CreatesQueuedRecipientRows(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	bob := createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})
	createGuestT(t, f, p.ID, "Carol", guestOpts{}) // no email: not enqueued

	send, stats, err := f.emails.CreateSend(ctx(), emails.SendEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Save the date!",
		Filter:  models.RecipientFilter{Side: pointerutil.String(models.SideRobin)},
	})
	require.NoError(t, err)

	assert.Equal(t, testSentBy, send.SentBy)
	assert.False(t, send.SentAt.IsZero())
	assert.Nil(t, send.TemplateID)
	// The filter is snapshotted on the send for the audit trail.
	require.NotNil(t, send.RecipientFilter.Side)
	assert.Equal(t, models.SideRobin, *send.RecipientFilter.Side)
	assert.Equal(t, emails.SendStats{Queued: 2, Total: 2}, stats)

	rows := recipientsForSend(t, f.db, send.ID)
	require.Len(t, rows, 2)
	assert.Equal(t, models.EmailQueued, rows[alice.ID].Status)
	assert.Equal(t, "alice@example.com", rows[alice.ID].EmailAddress)
	assert.Nil(t, rows[alice.ID].MailgunMessageID)
	assert.Equal(t, models.EmailQueued, rows[bob.ID].Status)
}

func TestCreateSend_RecordsTemplateProvenance(t *testing.T) {
	f := newFixtures(t)
	tpl := createTemplateT(t, f, templateInput())
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send, _, err := f.emails.CreateSend(ctx(), emails.SendEmailPayload{
		TemplateID: &tpl.ID,
		Subject:    "Edited subject",
		Body:       "Edited body",
	})
	require.NoError(t, err)
	require.NotNil(t, send.TemplateID)
	assert.Equal(t, tpl.ID, *send.TemplateID)
	// The send carries the edited copy, not the template's.
	assert.Equal(t, "Edited subject", send.Subject)

	// Deleting the template afterwards keeps the send (template_id nulls out).
	require.NoError(t, f.emails.DeleteTemplate(ctx(), tpl.ID))
	got, err := loadSendT(t, f, send.ID)
	require.NoError(t, err)
	assert.Nil(t, got.TemplateID)
}

func TestCreateSend_MissingTemplateIs422(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	_, _, err := f.emails.CreateSend(ctx(), emails.SendEmailPayload{
		TemplateID: pointerutil.String("00000000-0000-0000-0000-000000000000"),
		Subject:    "s",
		Body:       "b",
	})
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestCreateSend_NoRecipientsIs422(t *testing.T) {
	f := newFixtures(t)
	// One guest exists but has no email, so the filter matches nobody sendable.
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{})

	_, _, err := f.emails.CreateSend(ctx(), emails.SendEmailPayload{Subject: "s", Body: "b"})
	assertErrCode(t, err, errcodes.CodeValidationError)
}

func TestListSends_NewestFirstWithStats(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	first, _, err := f.emails.CreateSend(ctx(), emails.SendEmailPayload{Subject: "one", Body: "b"})
	require.NoError(t, err)
	second, _, err := f.emails.CreateSend(ctx(), emails.SendEmailPayload{Subject: "two", Body: "b"})
	require.NoError(t, err)

	sends, total, err := f.emails.ListSends(ctx())
	require.NoError(t, err)
	assert.Equal(t, 2, total)
	require.Len(t, sends, 2)
	assert.Equal(t, second.ID, sends[0].ID)
	assert.Equal(t, first.ID, sends[1].ID)

	stats, err := f.emails.SendStatsBySendIDs(ctx(), []string{first.ID, second.ID})
	require.NoError(t, err)
	assert.Equal(t, emails.SendStats{Queued: 1, Total: 1}, stats[first.ID])
	assert.Equal(t, emails.SendStats{Queued: 1, Total: 1}, stats[second.ID])
}

func TestGetSendDetail_ReturnsRecipientsWithGuestContext(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send, _, err := f.emails.CreateSend(ctx(), emails.SendEmailPayload{Subject: "s", Body: "b"})
	require.NoError(t, err)

	got, recipients, err := f.emails.GetSendDetail(ctx(), send.ID)
	require.NoError(t, err)
	assert.Equal(t, send.ID, got.ID)
	require.Len(t, recipients, 1)
	assert.Equal(t, alice.ID, recipients[0].GuestID)
	require.NotNil(t, recipients[0].Guest)
	assert.Equal(t, "Alice", recipients[0].Guest.FullName)
	require.NotNil(t, recipients[0].Guest.Party)
	assert.Equal(t, "The Smiths", recipients[0].Guest.Party.Name)
}

func TestGetSendDetail_MissingIs404(t *testing.T) {
	f := newFixtures(t)
	_, _, err := f.emails.GetSendDetail(ctx(), "00000000-0000-0000-0000-000000000000")
	assertErrCode(t, err, errcodes.CodeNotFound)
}

// loadSendT reads a send row straight from the DB.
func loadSendT(t *testing.T, f fixtures, id string) (*models.EmailSend, error) {
	t.Helper()
	send := new(models.EmailSend)
	err := f.db.NewSelect().Model(send).Where("es.id = ?", id).Scan(ctx())
	return send, err
}
