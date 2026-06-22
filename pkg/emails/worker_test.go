package emails_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/emails"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeMailgun is the test double for the MailgunClient seam: it records every
// send, can fail specific addresses, can block mid-send (for the shutdown
// test), and serves canned answers to the reconciliation lookup. No test ever
// calls the real Mailgun API.
type fakeMailgun struct {
	mu       sync.Mutex
	sent     []emails.Message
	failTo   map[string]error
	accepted map[string]string // recipientID -> message id served by FindAcceptedMessageID
	findErr  error
	// sendCalls counts every Send call, successful or not, so tests can assert
	// rows requeued for quota reasons were never dispatched at all.
	sendCalls int
	// findHook, when non-nil, runs at the start of every
	// FindAcceptedMessageID call, letting a test mutate the row mid-check
	// (simulating another worker instance resolving it concurrently).
	findHook func(recipientID string)
	// blockSends, when non-nil, makes every Send wait until the channel is
	// closed, simulating an in-flight batch during shutdown.
	blockSends chan struct{}
	// claimed is signaled once per Send call as it begins, letting tests
	// synchronize with a blocked in-flight batch.
	claimed chan struct{}
}

func newFakeMailgun() *fakeMailgun {
	return &fakeMailgun{failTo: map[string]error{}, accepted: map[string]string{}}
}

func (f *fakeMailgun) Send(_ context.Context, msg emails.Message) (string, error) {
	f.mu.Lock()
	claimed := f.claimed
	block := f.blockSends
	f.mu.Unlock()
	if claimed != nil {
		claimed <- struct{}{}
	}
	if block != nil {
		<-block
	}

	f.mu.Lock()
	defer f.mu.Unlock()
	f.sendCalls++
	if err, ok := f.failTo[msg.To]; ok {
		return "", err
	}
	f.sent = append(f.sent, msg)
	return fmt.Sprintf("msg-%d@test.mailgun", len(f.sent)), nil
}

func (f *fakeMailgun) sendCallCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sendCalls
}

func (f *fakeMailgun) FindAcceptedMessageID(_ context.Context, recipientID, _ string) (string, bool, error) {
	f.mu.Lock()
	hook := f.findHook
	f.mu.Unlock()
	if hook != nil {
		hook(recipientID)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.findErr != nil {
		return "", false, f.findErr
	}
	id, ok := f.accepted[recipientID]
	return id, ok, nil
}

func (f *fakeMailgun) sentMessages() []emails.Message {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]emails.Message(nil), f.sent...)
}

const testFrom = "Robin & Madeline <hello@example.test>"

// workerConfig is the default test tuning: small batches, fast polling, and a
// short stuck threshold so reconciliation tests do not wait minutes.
func workerConfig() emails.WorkerConfig {
	return emails.WorkerConfig{
		From:           testFrom,
		PublicBaseURL:  testBaseURL,
		BatchSize:      10,
		PollInterval:   10 * time.Millisecond,
		StuckThreshold: time.Minute,
	}
}

func newWorker(f fixtures, client emails.MailgunClient, cfg emails.WorkerConfig) *emails.Worker {
	return emails.NewWorker(f.db, client, cfg, logger.New())
}

// queueSend creates a send via the service (so rows are enqueued exactly as
// production does) and returns it.
func queueSend(t *testing.T, f fixtures, payload emails.SendEmailPayload) *models.EmailSend {
	t.Helper()
	send, _, err := f.emails.CreateSend(ctx(), payload)
	require.NoError(t, err)
	return send
}

func TestProcessBatch_SendsQueuedRowsWithRenderedMergeFields(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{rsvpCode: pointerutil.String("KALEL")})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	bob := createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{
		Subject: "Hi {{guest_name}}",
		Body:    "Your code is {{rsvp_code}}; rsvp at {{rsvp_link}}",
	})

	client := newFakeMailgun()
	w := newWorker(f, client, workerConfig())

	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 2, n)

	// Both rows are sent with their Mailgun message ids recorded.
	rows := recipientsForSend(t, f.db, send.ID)
	require.Len(t, rows, 2)
	for _, g := range []*models.Guest{alice, bob} {
		require.Equal(t, models.EmailSent, rows[g.ID].Status, g.FullName)
		require.NotNil(t, rows[g.ID].MailgunMessageID, g.FullName)
		assert.Nil(t, rows[g.ID].FailureReason, g.FullName)
	}

	// The messages carried per-recipient rendered merge fields, the configured
	// from address, and the row id as the reconciliation variable.
	msgs := client.sentMessages()
	require.Len(t, msgs, 2)
	byTo := map[string]emails.Message{}
	for _, m := range msgs {
		byTo[m.To] = m
	}
	require.Contains(t, byTo, "alice@example.com")
	assert.Equal(t, "Hi Alice", byTo["alice@example.com"].Subject)
	assert.Equal(t, "Your code is KALEL; rsvp at "+testBaseURL+"/rsvp", byTo["alice@example.com"].Text)
	// The HTML body carries the same resolved merge fields, wrapped in the shell
	// (so a client renders the designed email, not just the plaintext fallback).
	aliceHTML := byTo["alice@example.com"].HTML
	assert.Contains(t, aliceHTML, "<!doctype html>")
	assert.Contains(t, aliceHTML, "Your code is KALEL")
	assert.Contains(t, aliceHTML, testBaseURL+"/rsvp")
	assert.Equal(t, testFrom, byTo["alice@example.com"].From)
	assert.Equal(t, rows[alice.ID].ID, byTo["alice@example.com"].RecipientID)
	assert.Equal(t, "Hi Bob", byTo["bob@example.com"].Subject)

	// A second batch finds an empty queue.
	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
}

func TestProcessBatch_RendersEventFieldsFromFilterEvent(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	event, err := f.events.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Reception", Date: "2026-10-17", IsPublic: true,
	})
	require.NoError(t, err)

	queueSend(t, f, emails.SendEmailPayload{
		Subject: "{{event_name}}",
		Body:    "See you on {{event_date}}",
		Filter:  models.RecipientFilter{EventID: &event.ID},
	})

	client := newFakeMailgun()
	w := newWorker(f, client, workerConfig())
	_, err = w.ProcessBatch(ctx())
	require.NoError(t, err)

	msgs := client.sentMessages()
	require.Len(t, msgs, 1)
	assert.Equal(t, "Reception", msgs[0].Subject)
	assert.Equal(t, "See you on Saturday, October 17, 2026", msgs[0].Text)
}

func TestProcessBatch_EventDeletedAfterQueueingRendersEventFieldsEmpty(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	event, err := f.events.CreateEvent(ctx(), events.CreateEventPayload{
		Name: "Reception", Date: "2026-10-17", IsPublic: true,
	})
	require.NoError(t, err)

	send := queueSend(t, f, emails.SendEmailPayload{
		Subject: "About {{event_name}}",
		Body:    "It is on {{event_date}}.",
		Filter:  models.RecipientFilter{EventID: &event.ID},
	})
	// The event vanishes between enqueue and pickup. Deleting it cascades the
	// Event RSVP rows but not the already-snapshotted recipient rows, so the
	// send still goes out, just with empty event fields.
	require.NoError(t, f.events.DeleteEvent(ctx(), event.ID))

	client := newFakeMailgun()
	w := newWorker(f, client, workerConfig())
	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	assert.Equal(t, models.EmailSent, recipientsForSend(t, f.db, send.ID)[alice.ID].Status)
	msgs := client.sentMessages()
	require.Len(t, msgs, 1)
	assert.Equal(t, "About ", msgs[0].Subject)
	assert.Equal(t, "It is on .", msgs[0].Text)
}

func TestProcessBatch_MailgunRejectionMarksRowFailed(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	bob := createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// A definitive rejection (Mailgun answered non-2xx) is the only send error
	// that fails the row: the message provably never went out.
	client := newFakeMailgun()
	client.failTo["bob@example.com"] = &emails.RejectionError{StatusCode: 400, Body: "'to' parameter is invalid"}
	w := newWorker(f, client, workerConfig())

	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 2, n)

	// One failure never blocks the rest of the batch.
	rows := recipientsForSend(t, f.db, send.ID)
	assert.Equal(t, models.EmailSent, rows[alice.ID].Status)
	assert.Equal(t, models.EmailFailed, rows[bob.ID].Status)
	require.NotNil(t, rows[bob.ID].FailureReason)
	assert.Contains(t, *rows[bob.ID].FailureReason, "status 400")
	assert.Nil(t, rows[bob.ID].MailgunMessageID)
}

func TestProcessBatch_AmbiguousSendErrorLeavesRowSendingForReconciliation(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// A transport-level error (timeout, connection reset) is ambiguous:
	// Mailgun may have accepted the message before the connection died.
	// Failing the row would misreport a possibly-delivered email and invite a
	// duplicate manual resend, so it must stay `sending` for the reconciler.
	client := newFakeMailgun()
	client.failTo["alice@example.com"] = errors.New("call mailgun send: context deadline exceeded")
	w := newWorker(f, client, workerConfig())

	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	assert.Equal(t, models.EmailSending, row.Status)
	assert.Nil(t, row.FailureReason)
	assert.Nil(t, row.MailgunMessageID)

	// The row is not claimable while `sending`; only the reconciler may
	// settle it (against Mailgun's event log) once it ages past the threshold.
	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
}

func TestProcessBatch_SendsToSnapshottedAddressNotTheGuestsCurrentOne(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// The guest's email changes between enqueue and pickup; the send must go
	// to the snapshotted address the admin previewed.
	_, err := f.db.NewUpdate().Model((*models.Guest)(nil)).
		Set("email = ?", "changed@example.com").
		Where("id = ?", alice.ID).Exec(ctx())
	require.NoError(t, err)

	client := newFakeMailgun()
	w := newWorker(f, client, workerConfig())
	_, err = w.ProcessBatch(ctx())
	require.NoError(t, err)

	msgs := client.sentMessages()
	require.Len(t, msgs, 1)
	assert.Equal(t, "alice@example.com", msgs[0].To)
}

func TestProcessBatch_GuestUnsubscribedAfterQueueingIsSkippedNotSent(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	bob := createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// Bob unsubscribes after the send was enqueued but before the worker picks
	// up his row (the two-day send window at the daily cap, ADR 0009). The
	// re-check at send time must honor it.
	_, err := f.db.NewUpdate().Model((*models.Guest)(nil)).
		Set("subscribed = ?", false).Where("id = ?", bob.ID).Exec(ctx())
	require.NoError(t, err)

	client := newFakeMailgun()
	w := newWorker(f, client, workerConfig())
	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 2, n)

	rows := recipientsForSend(t, f.db, send.ID)
	assert.Equal(t, models.EmailSent, rows[alice.ID].Status)
	// Bob's row is terminal-unsubscribed, never sent; Mailgun was called only
	// for Alice.
	assert.Equal(t, models.EmailUnsubscribed, rows[bob.ID].Status)
	assert.Equal(t, 1, client.sendCallCount())

	// The unsubscribed row is tallied in its own bucket, not as sent or failed.
	stats, err := f.emails.SendStatsBySendIDs(ctx(), []string{send.ID})
	require.NoError(t, err)
	assert.Equal(t, 1, stats[send.ID].Sent)
	assert.Equal(t, 1, stats[send.ID].Unsubscribed)
}

func TestProcessBatch_TestSendDeliversEvenWhenRenderGuestUnsubscribed(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	g := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	// Unsubscribe the only matching guest. SendTest still renders from them, but
	// the worker must NOT suppress a test send: its row is addressed to the
	// couple's inbox, not the render guest (ADR 0009).
	_, err := f.db.NewUpdate().Model((*models.Guest)(nil)).
		Set("subscribed = ?", false).Where("id = ?", g.ID).Exec(ctx())
	require.NoError(t, err)

	resp, err := f.emails.WithTestSend([]string{"Robin <robin@example.com>"}).
		SendTest(ctx(), emails.TestEmailPayload{Subject: "s", Body: "b"})
	require.NoError(t, err)

	client := newFakeMailgun()
	w := newWorker(f, client, workerConfig())
	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	rows := recipientsForSend(t, f.db, resp.SendID)
	require.Len(t, rows, 1)
	assert.Equal(t, models.EmailSent, rows[g.ID].Status)
	assert.Equal(t, 1, client.sendCallCount())
}

func TestProcessBatch_RejectionReasonWithInvalidUTF8IsSanitized(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// A Mailgun error body can carry arbitrary bytes; if they reached Postgres
	// unsanitized the status write itself would fail, stranding the row in a
	// reconcile-and-fail loop.
	client := newFakeMailgun()
	client.failTo["alice@example.com"] = &emails.RejectionError{StatusCode: 400, Body: "bad \xff\xfe bytes"}
	w := newWorker(f, client, workerConfig())

	_, err := w.ProcessBatch(ctx())
	require.NoError(t, err)

	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	assert.Equal(t, models.EmailFailed, row.Status)
	require.NotNil(t, row.FailureReason)
	assert.Contains(t, *row.FailureReason, "status 400")
	assert.Contains(t, *row.FailureReason, "bad")
}

func TestProcessBatch_RespectsBatchSize(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	cfg := workerConfig()
	cfg.BatchSize = 1
	client := newFakeMailgun()
	w := newWorker(f, client, cfg)

	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	assert.Len(t, client.sentMessages(), 1)

	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	assert.Len(t, client.sentMessages(), 2)
}

func TestRun_GracefulShutdownFinishesInFlightBatchAndStops(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	bob := createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// One batch covers both rows; sends block until released so the batch is
	// reliably in flight when the shutdown signal arrives.
	client := newFakeMailgun()
	client.blockSends = make(chan struct{})
	client.claimed = make(chan struct{}, 2)
	w := newWorker(f, client, workerConfig())

	runCtx, cancel := context.WithCancel(ctx())
	go w.Run(runCtx)

	// Wait until the first send is in flight, then signal shutdown mid-batch.
	select {
	case <-client.claimed:
	case <-time.After(5 * time.Second):
		t.Fatal("worker never started sending")
	}
	cancel()
	close(client.blockSends)

	select {
	case <-w.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not stop after cancel")
	}

	// The in-flight batch finished: both rows sent, nothing stranded in
	// sending or queued.
	rows := recipientsForSend(t, f.db, send.ID)
	assert.Equal(t, models.EmailSent, rows[alice.ID].Status)
	assert.Equal(t, models.EmailSent, rows[bob.ID].Status)
}

func TestRun_StopsPickingUpNewBatchesAfterCancel(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	bob := createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// Batch size 1: Alice's row is the in-flight batch; after cancel the
	// worker must NOT claim Bob's.
	cfg := workerConfig()
	cfg.BatchSize = 1
	client := newFakeMailgun()
	client.blockSends = make(chan struct{})
	client.claimed = make(chan struct{}, 2)
	w := newWorker(f, client, cfg)

	runCtx, cancel := context.WithCancel(ctx())
	go w.Run(runCtx)

	select {
	case <-client.claimed:
	case <-time.After(5 * time.Second):
		t.Fatal("worker never started sending")
	}
	cancel()
	close(client.blockSends)

	select {
	case <-w.Done():
	case <-time.After(5 * time.Second):
		t.Fatal("worker did not stop after cancel")
	}

	rows := recipientsForSend(t, f.db, send.ID)
	// The claimed batch finished; the next one was never picked up.
	sentCount := 0
	queuedCount := 0
	for _, g := range []*models.Guest{alice, bob} {
		switch rows[g.ID].Status {
		case models.EmailSent:
			sentCount++
		case models.EmailQueued:
			queuedCount++
		}
	}
	assert.Equal(t, 1, sentCount)
	assert.Equal(t, 1, queuedCount)
	assert.Len(t, client.sentMessages(), 1)
}

// strandRow simulates a crash: flips a recipient row to `sending` with an
// updated_at older than the stuck threshold.
func strandRow(t *testing.T, f fixtures, rowID string, age time.Duration) {
	t.Helper()
	_, err := f.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
		Set("status = ?", models.EmailSending).
		Set("updated_at = now() - make_interval(secs => ?)", age.Seconds()).
		Where("id = ?", rowID).Exec(ctx())
	require.NoError(t, err)
}

func TestReconcileStuck_AlreadyAcceptedRowIsMarkedSentWithoutResending(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	rows := recipientsForSend(t, f.db, send.ID)
	row := rows[alice.ID]
	strandRow(t, f, row.ID, 10*time.Minute)

	// Mailgun's event log says this row's email was already accepted before
	// the crash.
	client := newFakeMailgun()
	client.accepted[row.ID] = "recovered-id@test.mailgun"
	w := newWorker(f, client, workerConfig())

	n, err := w.ReconcileStuck(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	got := recipientsForSend(t, f.db, send.ID)[alice.ID]
	assert.Equal(t, models.EmailSent, got.Status)
	require.NotNil(t, got.MailgunMessageID)
	assert.Equal(t, "recovered-id@test.mailgun", *got.MailgunMessageID)

	// Crucially, nothing was re-sent: no duplicate email.
	assert.Empty(t, client.sentMessages())
	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
	assert.Empty(t, client.sentMessages())
}

func TestReconcileStuck_UnseenRowIsRequeuedAndRetriedOnce(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	strandRow(t, f, row.ID, 10*time.Minute)

	// Mailgun never saw this row's email: the crash happened before the API
	// call, so retrying cannot duplicate.
	client := newFakeMailgun()
	w := newWorker(f, client, workerConfig())

	n, err := w.ReconcileStuck(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	assert.Equal(t, models.EmailQueued, recipientsForSend(t, f.db, send.ID)[alice.ID].Status)

	// The requeued row sends exactly once on the next batch.
	_, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, models.EmailSent, recipientsForSend(t, f.db, send.ID)[alice.ID].Status)
	assert.Len(t, client.sentMessages(), 1)
}

func TestProcessBatch_WebhookOutcomeLandingMidSendIsNotStomped(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	row := recipientsForSend(t, f.db, send.ID)[alice.ID]

	// While the Mailgun call is in flight, the delivery webhook lands first
	// (via its recipient_id fallback) and records a bounce. The worker's
	// success-path write must not downgrade that terminal outcome back to
	// `sent`: Mailgun never resends an acknowledged event, so the bounce
	// would be lost forever.
	client := newFakeMailgun()
	client.blockSends = make(chan struct{})
	client.claimed = make(chan struct{}, 1)
	w := newWorker(f, client, workerConfig())

	done := make(chan struct{})
	go func() {
		defer close(done)
		_, err := w.ProcessBatch(ctx())
		assert.NoError(t, err)
	}()

	select {
	case <-client.claimed:
	case <-time.After(5 * time.Second):
		t.Fatal("worker never started sending")
	}
	_, err := f.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
		Set("status = ?", models.EmailBounced).
		Set("mailgun_message_id = ?", "from-webhook@test.mailgun").
		Set("failure_reason = ?", "mailbox full").
		Where("id = ?", row.ID).Exec(ctx())
	require.NoError(t, err)
	close(client.blockSends)
	<-done

	got := recipientsForSend(t, f.db, send.ID)[alice.ID]
	assert.Equal(t, models.EmailBounced, got.Status)
	require.NotNil(t, got.FailureReason)
	assert.Equal(t, "mailbox full", *got.FailureReason)
	require.NotNil(t, got.MailgunMessageID)
	assert.Equal(t, "from-webhook@test.mailgun", *got.MailgunMessageID)
}

func TestReconcileStuck_ThresholdIsFlooredAtTheBatchBudget(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	// Old enough for the configured threshold, but a 40-row batch can keep a
	// claimed row legitimately in `sending` for its whole budget (40 x 30s),
	// so the effective threshold must floor there and leave the row alone:
	// requeueing it would double-send once the owning worker reaches it.
	strandRow(t, f, row.ID, 10*time.Minute)

	cfg := workerConfig()
	cfg.BatchSize = 40
	cfg.StuckThreshold = time.Minute
	client := newFakeMailgun()
	w := newWorker(f, client, cfg)

	n, err := w.ReconcileStuck(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
	assert.Equal(t, models.EmailSending, recipientsForSend(t, f.db, send.ID)[alice.ID].Status)
}

func TestReconcileStuck_FreshSendingRowsAreLeftAlone(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	// In sending, but younger than the threshold: a live worker may own it.
	strandRow(t, f, row.ID, time.Second)

	client := newFakeMailgun()
	w := newWorker(f, client, workerConfig())

	n, err := w.ReconcileStuck(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
	assert.Equal(t, models.EmailSending, recipientsForSend(t, f.db, send.ID)[alice.ID].Status)
}

func TestRun_ReconcilesStuckRowsWithoutADirectCall(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	strandRow(t, f, row.ID, 10*time.Minute)

	// Pins that Run's cycle actually invokes the reconciler: the stranded row
	// must be settled (here: already accepted, so marked sent) by Run alone,
	// with no direct ReconcileStuck call. Dropping the reconcile step from the
	// loop would leave crash-stranded rows in `sending` forever.
	client := newFakeMailgun()
	client.accepted[row.ID] = "recovered-id@test.mailgun"
	w := newWorker(f, client, workerConfig())

	runCtx, cancel := context.WithCancel(ctx())
	go w.Run(runCtx)

	require.Eventually(t, func() bool {
		return recipientsForSend(t, f.db, send.ID)[alice.ID].Status == models.EmailSent
	}, 5*time.Second, 20*time.Millisecond, "Run never reconciled the stranded row")
	cancel()
	<-w.Done()

	assert.Empty(t, client.sentMessages())
}

func TestReconcileStuck_RowResolvedMidCheckIsNotClobbered(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	strandRow(t, f, row.ID, 10*time.Minute)

	// While this reconciler is mid-check (its Mailgun lookup in flight),
	// another worker instance requeues, claims, and sends the row. The stale
	// not-found answer must not overwrite that outcome: requeueing a sent row
	// would wipe its message id and queue a duplicate email.
	client := newFakeMailgun()
	client.findHook = func(string) {
		_, err := f.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
			Set("status = ?", models.EmailSent).
			Set("mailgun_message_id = ?", "won-the-race@test.mailgun").
			Where("id = ?", row.ID).Exec(ctx())
		require.NoError(t, err)
	}
	w := newWorker(f, client, workerConfig())

	n, err := w.ReconcileStuck(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	got := recipientsForSend(t, f.db, send.ID)[alice.ID]
	assert.Equal(t, models.EmailSent, got.Status)
	require.NotNil(t, got.MailgunMessageID)
	assert.Equal(t, "won-the-race@test.mailgun", *got.MailgunMessageID)
}

func TestReconcileStuck_RequeueRacingAReclaimedRowIsNotApplied(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	strandRow(t, f, row.ID, 10*time.Minute)

	// The ABA shape two overlapping reconcilers can produce: while this
	// instance's Mailgun check is in flight, the other instance requeues the
	// row AND its worker re-claims it, so the row is `sending` again but
	// under a fresh claim (fresh updated_at). This instance's stale
	// not-found answer must not requeue it: that would queue a third send on
	// top of the one now in flight.
	client := newFakeMailgun()
	client.findHook = func(string) {
		_, err := f.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
			Set("status = ?", models.EmailSending).
			Set("updated_at = now()").
			Where("id = ?", row.ID).Exec(ctx())
		require.NoError(t, err)
	}
	w := newWorker(f, client, workerConfig())

	n, err := w.ReconcileStuck(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	// The stale requeue was a no-op: the row still belongs to the fresh claim.
	assert.Equal(t, models.EmailSending, recipientsForSend(t, f.db, send.ID)[alice.ID].Status)
}

func TestProcessBatch_ConcurrentWorkersNeverDoubleSend(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	const guests = 24
	for i := 0; i < guests; i++ {
		createGuestT(t, f, p.ID, fmt.Sprintf("Guest %02d", i), guestOpts{
			email: emailOf(fmt.Sprintf("guest%02d@example.com", i)),
		})
	}
	queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// Three workers (one shared recording client) drain the same queue
	// concurrently, the deploy-overlap shape the SKIP LOCKED claim exists
	// for: every row must be sent exactly once.
	client := newFakeMailgun()
	cfg := workerConfig()
	cfg.BatchSize = 3
	var wg sync.WaitGroup
	for i := 0; i < 3; i++ {
		w := newWorker(f, client, cfg)
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				n, err := w.ProcessBatch(ctx())
				assert.NoError(t, err)
				if n == 0 {
					return
				}
			}
		}()
	}
	wg.Wait()

	msgs := client.sentMessages()
	assert.Len(t, msgs, guests)
	seen := map[string]bool{}
	for _, m := range msgs {
		assert.False(t, seen[m.RecipientID], "recipient %s sent twice", m.RecipientID)
		seen[m.RecipientID] = true
	}
}

// fakeClock is a mutable injected clock for the daily-budget tests: the worker
// computes UTC day boundaries from it, so tests can cross midnight without
// waiting.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *fakeClock) now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) set(t time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = t
}

// setAttemptedAt backdates (or sets) a row's recorded dispatch attempt
// straight in the DB, simulating an attempt made at a specific time.
func setAttemptedAt(t *testing.T, f fixtures, rowID string, at time.Time) {
	t.Helper()
	_, err := f.db.NewUpdate().Model((*models.EmailRecipient)(nil)).
		Set("attempted_at = ?", at).
		Where("id = ?", rowID).Exec(ctx())
	require.NoError(t, err)
}

// statusCounts tallies a send's recipient rows by status.
func statusCounts(t *testing.T, f fixtures, sendID string) map[string]int {
	t.Helper()
	counts := map[string]int{}
	for _, row := range recipientsForSend(t, f.db, sendID) {
		counts[row.Status]++
	}
	return counts
}

func TestProcessBatch_DailyBudgetCapsTheClaimSize(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	for i := 0; i < 5; i++ {
		createGuestT(t, f, p.ID, fmt.Sprintf("Guest %d", i), guestOpts{
			email: emailOf(fmt.Sprintf("guest%d@example.com", i)),
		})
	}
	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// Five queued, batch size 10, but only three daily sends left: the claim
	// must stop at three.
	cfg := workerConfig()
	cfg.DailySendLimit = 3
	client := newFakeMailgun()
	w := newWorker(f, client, cfg)

	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 3, n)
	assert.Len(t, client.sentMessages(), 3)

	counts := statusCounts(t, f, send.ID)
	assert.Equal(t, 3, counts[models.EmailSent])
	assert.Equal(t, 2, counts[models.EmailQueued])

	// The budget is spent: further batches claim nothing and the leftover rows
	// simply wait for the next UTC day.
	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
	assert.Len(t, client.sentMessages(), 3)
	assert.Equal(t, 2, statusCounts(t, f, send.ID)[models.EmailQueued])
}

func TestProcessBatch_DailyBudgetResetsAtUTCMidnight(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	for i := 0; i < 3; i++ {
		createGuestT(t, f, p.ID, fmt.Sprintf("Guest %d", i), guestOpts{
			email: emailOf(fmt.Sprintf("guest%d@example.com", i)),
		})
	}
	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	clock := &fakeClock{t: time.Date(2030, 5, 10, 23, 0, 0, 0, time.UTC)}
	cfg := workerConfig()
	cfg.DailySendLimit = 2
	cfg.Now = clock.now
	client := newFakeMailgun()
	w := newWorker(f, client, cfg)

	// Day one: the budget covers two of the three rows, then claims stop.
	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 2, n)
	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)

	// Just past UTC midnight the budget is fresh and the leftover row drains.
	clock.set(time.Date(2030, 5, 11, 0, 5, 0, 0, time.UTC))
	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	assert.Len(t, client.sentMessages(), 3)
	assert.Equal(t, 3, statusCounts(t, f, send.ID)[models.EmailSent])
}

func TestProcessBatch_BudgetCountsAttemptsAgainstTheDayTheyHappened(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// Alice's row was attempted yesterday and requeued by the reconciler:
	// yesterday's attempt consumed yesterday's budget, so today it costs a
	// fresh slot but starts from a clean count.
	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	setAttemptedAt(t, f, row.ID, time.Now().UTC().Add(-25*time.Hour))

	cfg := workerConfig()
	cfg.DailySendLimit = 1
	client := newFakeMailgun()
	w := newWorker(f, client, cfg)

	// Yesterday's attempt does not count against today: one claim goes through.
	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	// That claim was today's whole budget; the other row waits for tomorrow.
	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
	counts := statusCounts(t, f, send.ID)
	assert.Equal(t, 1, counts[models.EmailSent])
	assert.Equal(t, 1, counts[models.EmailQueued])
}

func TestProcessBatch_QuotaRejectionRequeuesAndPausesUntilNextUTCDay(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	bob := createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// The local count says budget remains, but Mailgun disagrees (e.g. manual
	// dashboard sends spent the real quota): a 429 must requeue the row, not
	// fail it, and stop further dispatches for the rest of the UTC day.
	clock := &fakeClock{t: time.Date(2030, 5, 10, 22, 0, 0, 0, time.UTC)}
	cfg := workerConfig()
	cfg.DailySendLimit = 100
	cfg.Now = clock.now
	client := newFakeMailgun()
	quota := &emails.RejectionError{StatusCode: 429, Body: "Quota exceeded"}
	client.failTo["alice@example.com"] = quota
	client.failTo["bob@example.com"] = quota
	w := newWorker(f, client, cfg)

	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 2, n)

	// Both rows are queued again (never failed), and only the first ever
	// reached Mailgun: once the quota answer arrived, the rest of the claimed
	// batch was requeued without another doomed call.
	rows := recipientsForSend(t, f.db, send.ID)
	for _, g := range []*models.Guest{alice, bob} {
		assert.Equal(t, models.EmailQueued, rows[g.ID].Status, g.FullName)
		assert.Nil(t, rows[g.ID].FailureReason, g.FullName)
		assert.Nil(t, rows[g.ID].MailgunMessageID, g.FullName)
	}
	assert.Equal(t, 1, client.sendCallCount())

	// Only the row that actually drew the quota answer accrues a requeue
	// toward the fail-after cap; the batch-mate requeued precautionarily
	// (without a Mailgun call) does not, so a long quota outage can never
	// spuriously fail rows that were never rejected themselves.
	assert.Equal(t, 1, rows[alice.ID].QuotaRequeues+rows[bob.ID].QuotaRequeues)

	// The local budget is treated as exhausted for the rest of the UTC day,
	// even though the local count would still allow claims.
	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
	assert.Equal(t, 1, client.sendCallCount())

	// Mailgun's quota resets at UTC midnight; so does the pause.
	clock.set(time.Date(2030, 5, 11, 0, 5, 0, 0, time.UTC))
	client.mu.Lock()
	client.failTo = map[string]error{}
	client.mu.Unlock()

	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 2, n)
	assert.Equal(t, 2, statusCounts(t, f, send.ID)[models.EmailSent])
}

func TestProcessBatch_QuotaWordingInRejectionBodyRequeuesInsteadOfFailing(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// Mailgun does not promise a 429 for quota problems: a 4xx whose body
	// names the sending limit must get the same retry-tomorrow treatment, not
	// a permanent failure.
	cfg := workerConfig()
	cfg.DailySendLimit = 100
	client := newFakeMailgun()
	client.failTo["alice@example.com"] = &emails.RejectionError{
		StatusCode: 403,
		Body:       "Domain mg.example.com has reached its daily sending limit",
	}
	w := newWorker(f, client, cfg)

	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	assert.Equal(t, models.EmailQueued, row.Status)
	assert.Nil(t, row.FailureReason)

	// And the pause engaged: no more claims today.
	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
}

func TestProcessBatch_RepeatedQuotaRejectionsEventuallyFailTheRow(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// Mailgun answers quota on every attempt, day after day (each fresh
	// worker models a new day, since the quota pause is in-memory per
	// instance). The requeue loop must be bounded: a rejection misclassified
	// as quota would otherwise sort back to the head of the queue and stall
	// claims forever with no admin-visible signal.
	cfg := workerConfig()
	cfg.DailySendLimit = 100

	for attempt := 1; attempt <= 3; attempt++ {
		client := newFakeMailgun()
		client.failTo["alice@example.com"] = &emails.RejectionError{StatusCode: 429, Body: "Quota exceeded"}
		w := newWorker(f, client, cfg)

		n, err := w.ProcessBatch(ctx())
		require.NoError(t, err)
		require.Equal(t, 1, n, "attempt %d", attempt)

		row := recipientsForSend(t, f.db, send.ID)[alice.ID]
		assert.Equal(t, models.EmailQueued, row.Status, "attempt %d", attempt)
		assert.Equal(t, attempt, row.QuotaRequeues, "attempt %d", attempt)
	}

	// The fourth quota rejection exceeds the cap: the row fails with
	// Mailgun's words so the admin can see it on the send detail page.
	client := newFakeMailgun()
	client.failTo["alice@example.com"] = &emails.RejectionError{StatusCode: 429, Body: "Quota exceeded"}
	w := newWorker(f, client, cfg)

	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)

	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	assert.Equal(t, models.EmailFailed, row.Status)
	require.NotNil(t, row.FailureReason)
	assert.Contains(t, *row.FailureReason, "Quota exceeded")

	// With the poisoned row dispositioned, nothing is left queued: the
	// queue is no longer starved behind it.
	n, err = w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 0, n)
}

func TestProcessBatch_ConcurrentClaimsNeverOverspendTheBudget(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	for i := 0; i < 4; i++ {
		createGuestT(t, f, p.ID, fmt.Sprintf("Guest %d", i), guestOpts{
			email: emailOf(fmt.Sprintf("guest%d@example.com", i)),
		})
	}
	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// Four workers race for a budget of one (the deploy-overlap shape the
	// advisory lock serializes). SKIP LOCKED alone would hand each racer a
	// DIFFERENT row, so without the lock several could count the same "zero
	// used" snapshot and overspend; exactly one attempt may ever be stamped.
	cfg := workerConfig()
	cfg.DailySendLimit = 1
	client := newFakeMailgun()

	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		w := newWorker(f, client, cfg)
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := w.ProcessBatch(ctx())
			assert.NoError(t, err)
		}()
	}
	close(start)
	wg.Wait()

	attempted, err := f.db.NewSelect().Model((*models.EmailRecipient)(nil)).
		Where("attempted_at IS NOT NULL").Count(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, attempted)
	assert.Len(t, client.sentMessages(), 1)

	counts := statusCounts(t, f, send.ID)
	assert.Equal(t, 1, counts[models.EmailSent])
	assert.Equal(t, 3, counts[models.EmailQueued])
}

func TestProcessBatch_UnlimitedBudgetBypassesTheDailyCap(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	for i := 0; i < 3; i++ {
		createGuestT(t, f, p.ID, fmt.Sprintf("Guest %d", i), guestOpts{
			email: emailOf(fmt.Sprintf("guest%d@example.com", i)),
		})
	}
	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})

	// DailySendLimit zero (the paid-plan setting) disables the budget: every
	// queued row drains in one batch regardless of today's attempt count.
	cfg := workerConfig()
	cfg.DailySendLimit = 0
	client := newFakeMailgun()
	w := newWorker(f, client, cfg)

	n, err := w.ProcessBatch(ctx())
	require.NoError(t, err)
	assert.Equal(t, 3, n)
	assert.Equal(t, 3, statusCounts(t, f, send.ID)[models.EmailSent])
}

func TestRun_ReconciliationStillRunsWhileBudgetIsExhausted(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})
	bob := createGuestT(t, f, p.ID, "Bob", guestOpts{email: emailOf("bob@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	rows := recipientsForSend(t, f.db, send.ID)

	// Alice's row is crash-stranded in `sending` (already accepted by Mailgun
	// before the crash). Bob's row was attempted today and requeued, which
	// spends the whole daily budget of one.
	strandRow(t, f, rows[alice.ID].ID, 10*time.Minute)
	setAttemptedAt(t, f, rows[bob.ID].ID, time.Now().UTC())

	cfg := workerConfig()
	cfg.DailySendLimit = 1
	client := newFakeMailgun()
	client.accepted[rows[alice.ID].ID] = "recovered-id@test.mailgun"
	w := newWorker(f, client, cfg)

	runCtx, cancel := context.WithCancel(ctx())
	go w.Run(runCtx)

	// The paused worker must still reconcile: Alice's stranded row settles to
	// sent even though no claim budget remains.
	require.Eventually(t, func() bool {
		return recipientsForSend(t, f.db, send.ID)[alice.ID].Status == models.EmailSent
	}, 5*time.Second, 20*time.Millisecond, "Run never reconciled the stranded row while paused")
	cancel()
	<-w.Done()

	// Nothing was dispatched: Bob's row waits for tomorrow's budget.
	assert.Empty(t, client.sentMessages())
	assert.Equal(t, models.EmailQueued, recipientsForSend(t, f.db, send.ID)[bob.ID].Status)
}

func TestReconcileStuck_CheckErrorLeavesRowSending(t *testing.T) {
	f := newFixtures(t)
	p := createPartyT(t, f, "The Smiths", partyOpts{})
	alice := createGuestT(t, f, p.ID, "Alice", guestOpts{email: emailOf("alice@example.com")})

	send := queueSend(t, f, emails.SendEmailPayload{Subject: "s", Body: "b"})
	row := recipientsForSend(t, f.db, send.ID)[alice.ID]
	strandRow(t, f, row.ID, 10*time.Minute)

	// Mailgun unreachable: the row must NOT be requeued (that could double
	// send if the original call actually went through); it stays sending for
	// a later reconcile.
	client := newFakeMailgun()
	client.findErr = errors.New("mailgun events failed: status 500")
	w := newWorker(f, client, workerConfig())

	n, err := w.ReconcileStuck(ctx())
	require.NoError(t, err)
	assert.Equal(t, 1, n)
	assert.Equal(t, models.EmailSending, recipientsForSend(t, f.db, send.ID)[alice.ID].Status)
	assert.Empty(t, client.sentMessages())
}
