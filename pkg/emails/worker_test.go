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
	if err, ok := f.failTo[msg.To]; ok {
		return "", err
	}
	f.sent = append(f.sent, msg)
	return fmt.Sprintf("msg-%d@test.mailgun", len(f.sent)), nil
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
