package emails

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/database"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// WorkerConfig carries everything the queue worker needs beyond its database
// and Mailgun client. It is a struct (rather than positional parameters) so
// call sites name every field: From and PublicBaseURL are both plain strings,
// and a silent transposition would send email from the wrong address with
// broken links.
type WorkerConfig struct {
	// From is the sender address on every outbound email.
	From string
	// ReplyTo is the Reply-To address on every outbound email.
	ReplyTo string
	// PublicBaseURL is the site origin the merge-field links are built on.
	PublicBaseURL string
	// BatchSize is how many queued rows one batch claims.
	BatchSize int
	// StuckThreshold is how old a `sending` row must be before an activated
	// worker's reconcile pass treats it as stuck (left behind by a crash) and
	// checks it against Mailgun. It must comfortably exceed the longest
	// plausible in-flight send so a row a live worker is processing is never
	// touched; the worker
	// enforces that itself by flooring the effective threshold at the batch
	// budget (see effectiveStuckThreshold).
	StuckThreshold time.Duration
	// DailySendLimit caps how many rows the worker dispatches per UTC day,
	// matching Mailgun's free-plan quota (which resets at midnight UTC). Zero
	// or negative disables the cap. When the budget is spent, queued rows wait
	// for a later activation after the next UTC day begins; reconciliation also
	// resumes only on a later activation.
	DailySendLimit int
	// Now returns the current time; nil means time.Now. The daily budget
	// computes its UTC day boundaries from it, so tests inject a fake clock
	// to cross midnight without waiting.
	Now func() time.Time
}

// perSendBudget is the per-row slice of a batch's time budget: generously
// above the Mailgun client's own 15-second HTTP timeout plus the row's DB
// bookkeeping, so a batch budget of BatchSize*perSendBudget can never expire
// while a row's send is still within its own timeout.
const perSendBudget = 30 * time.Second

// maxFailureReason caps a stored failure_reason (the worker's markFailed and
// the webhook's event reason both apply it).
const maxFailureReason = 1000

// maxQuotaRequeues caps how many times a quota-classified rejection may
// requeue one row before the worker fails it instead. The cap bounds the cost
// of a rejection misclassified as quota: such a row sorts back to the head of
// the claim order and re-arms the day-long quota pause on every attempt, so
// without the cap it would starve the queue forever with no admin-visible
// signal. Three requeues tolerate a genuinely quota-blocked stretch while
// ensuring that maxQuotaRequeues+1 explicit activations on eligible UTC days
// end a misclassified row in a visible failed state.
const maxQuotaRequeues = 3

// dispatchCooldown is how long the worker skips claims after it stops an
// activation because Mailgun is refusing the account (a bad API key, a domain
// not allowed to send) or keeps failing (repeated unknown outcomes). The admin
// pages wake the worker every few seconds while a send is in flight, so
// without it each poll would send one more email into the same problem.
const dispatchCooldown = time.Minute

// maxUnknownInARow is how many unknown send outcomes in a row (5xx, timeout,
// connection error) the worker tolerates before it stops. One is a blip and
// the batch carries on, so a single hiccup never holds up the rest of a send;
// two in a row means Mailgun is having trouble, and every further attempt
// would only strand another row for reconciliation.
const maxUnknownInARow = 2

// accountProblemReason is shown on the send detail page for each row waiting
// out an account refusal, so "queued" is not left unexplained.
const accountProblemReason = "Not sent yet: Mailgun refused the account (%s). Fix the Mailgun API key or " +
	"sending domain, and this email will send on its own once you next open the email admin pages."

// unconfirmableAfter is how old a stuck `sending` row can get before the
// reconciler stops trusting a not-found answer from Mailgun's event log. The
// free plan keeps that log for one day, so past this age "not found" no longer
// means "never accepted", and requeueing could send a guest a second copy.
// Such a row is failed with an explanation instead, for the couple to check.
const unconfirmableAfter = 20 * time.Hour

// unconfirmableReason is the failure reason recorded on such a row.
const unconfirmableReason = "Delivery could not be confirmed: this email was interrupted mid-send and " +
	"Mailgun no longer has a record to check against. It may or may not have been delivered, so check " +
	"with the guest before resending."

// errActivationStopped ends an activation early: Mailgun kept failing or
// refused the account, or a row's data failed to load, so the rest of the
// claim was released back to the queue untouched rather than pushed into the
// same failure.
var errActivationStopped = errors.New("email worker stopped the activation early")

// Worker drains the email_recipients queue through Mailgun (ADR 0004). Each
// cycle reconciles stuck `sending` rows, then claims queued rows in batches
// (flipping them to `sending` so a concurrent pickup can never double-send),
// renders each recipient's merge fields, and records `sent` (with the Mailgun
// message id) or `failed` per row. Claims are capped at what remains of the
// daily send budget (DailySendLimit per UTC day, Mailgun's free-plan quota);
// when it is spent, queued rows wait for a later activation on a day with
// available budget. Reconciliation still runs at the start of every activation.
//
// Shutdown contract: cancel the context passed to Run. The worker stops
// picking up new batches but finishes the batch in flight (its Mailgun and DB
// calls run on a detached context), then Run returns and Done() closes.
type Worker struct {
	db         *bun.DB
	client     MailgunClient
	cfg        WorkerConfig
	log        logger.Logger
	supervisor *workerSupervisor

	// mu guards the fields below. The worker itself is single goroutine, but
	// the guard keeps the fields race-free if a test (or a future caller)
	// drives ProcessBatch concurrently.
	mu sync.Mutex
	// quotaPauseUntil is set to the next UTC midnight when Mailgun rejects a
	// send for quota: the local count evidently undercounts (e.g. manual
	// dashboard sends), so every further dispatch today is doomed and claims
	// stop until Mailgun's quota resets. It caches the pause saved in
	// app_settings (see pauseQuotaUntilTomorrow), which is what survives a
	// scale-to-zero restart.
	quotaPauseUntil time.Time
	// dispatchPauseUntil skips claims for dispatchCooldown after an activation
	// stopped over an account refusal or repeated unknown outcomes. In-memory:
	// after a restart the first failing send re-arms it.
	dispatchPauseUntil time.Time
	// unknownInARow counts consecutive unknown send outcomes (see
	// maxUnknownInARow); any definitive answer from Mailgun resets it.
	unknownInARow int
	// pauseLoggedDay dedupes the budget-pause log line to once per UTC day.
	pauseLoggedDay string
}

// NewWorker builds a Worker.
func NewWorker(db *bun.DB, client MailgunClient, cfg WorkerConfig, log logger.Logger) *Worker {
	w := &Worker{
		db:     db,
		client: client,
		cfg:    cfg,
		log:    log,
	}
	w.supervisor = newWorkerSupervisor(w.cycle, log)
	return w
}

// Wake requests an email delivery activation without doing database work in
// the caller. It never blocks: one pending wake is retained and additional
// simultaneous wakes coalesce into it. A wake received during an activation
// remains pending for another actionable-work check before the worker idles.
func (w *Worker) Wake() { w.supervisor.Wake() }

// Started is closed once Run has entered its database-free supervision loop.
func (w *Worker) Started() <-chan struct{} { return w.supervisor.Started() }

// Done is closed when Run has returned, letting main wait for the in-flight
// batch before closing the database.
func (w *Worker) Done() <-chan struct{} { return w.supervisor.Done() }

// Run waits without database work until an explicit wake is pending, then
// performs one activation. After the activation drains immediately actionable
// work or encounters a cycle-level database error, it waits again. Call Run in
// a goroutine; it returns only after ctx is canceled.
func (w *Worker) Run(ctx context.Context) {
	w.supervisor.Run(database.WithOperation(ctx, database.EmailWorkerOperation()))
}

// cycle runs one reconcile pass plus as many batches as the queue holds,
// stopping between batches once ctx is canceled. The work itself runs on a
// context detached from ctx's cancellation so a shutdown never aborts a batch
// midway (the finish-current-batch guarantee); each batch is separately
// time-bounded instead.
func (w *Worker) cycle(ctx context.Context) {
	if ctx.Err() != nil {
		return
	}
	detached := context.WithoutCancel(ctx)

	if _, err := w.ReconcileStuck(detached); err != nil {
		w.log.Err(err).Error("email worker reconcile failed")
		return
	}

	for {
		// Reconciliation and an already-claimed batch are detached so they can
		// finish, but the claim itself remains cancellation-aware. This closes
		// the race between checking ctx and beginning the claim transaction.
		n, err := w.processBatch(ctx, detached)
		if errors.Is(err, errActivationStopped) {
			return
		}
		if err != nil {
			if ctx.Err() == nil {
				w.log.Err(err).Error("email worker batch failed")
			}
			return
		}
		if n == 0 {
			return
		}
		select {
		case <-ctx.Done():
			return
		default:
		}
	}
}

// batchBudget bounds one batch (or reconcile pass) so a hung call can never
// stall the queue forever. It scales with BatchSize (each row gets
// perSendBudget, covering the Mailgun client's own timeout) with a two-minute
// floor, so raising EMAIL_WORKER_BATCH_SIZE can never silently starve the
// batch's tail rows of their send budget.
func (w *Worker) batchBudget() time.Duration {
	budget := time.Duration(w.cfg.BatchSize) * perSendBudget
	if budget < 2*time.Minute {
		budget = 2 * time.Minute
	}
	return budget
}

// ProcessBatch claims up to BatchSize queued rows (atomically flipping them to
// `sending`, with SKIP LOCKED so a concurrent claimer can never grab the same
// rows) and sends each through Mailgun, recording sent or failed per row. The
// claim is additionally capped at what remains of today's daily send budget
// (see claimBatch). It returns how many rows it claimed; zero means the queue
// is empty or the budget is exhausted. A batch that stopped early (see
// sendOne) is not an error here; it only ends Run's activation.
func (w *Worker) ProcessBatch(ctx context.Context) (int, error) {
	n, err := w.processBatch(ctx, ctx)
	if errors.Is(err, errActivationStopped) {
		err = nil
	}
	return n, err
}

// processBatch lets Run cancel a not-yet-committed claim while finishing a
// successfully claimed batch on a detached context. Direct callers use the
// same context for both through ProcessBatch.
func (w *Worker) processBatch(claimParent, workParent context.Context) (int, error) {
	claimCtx, cancelClaim := context.WithTimeout(claimParent, w.batchBudget())
	defer cancelClaim()
	workCtx, cancelWork := context.WithTimeout(workParent, w.batchBudget())
	defer cancelWork()

	claimed, err := w.claimBatch(claimCtx)
	if err != nil {
		return 0, err
	}
	if len(claimed) == 0 {
		return 0, nil
	}

	// Batches can span sends; cache each send and its filter event once.
	sends := map[string]*models.EmailSend{}
	events := map[string]*models.Event{}
	for i, row := range claimed {
		// A quota rejection earlier in this batch means every further
		// dispatch today is doomed to the same answer: requeue the rest of
		// the claim for the next UTC day without hammering Mailgun.
		if w.quotaPaused() {
			w.requeue(workCtx, row)
			continue
		}
		if stop, reason := w.sendOne(workCtx, row, sends, events); stop {
			// The rest of the claim was never dispatched: put it back as if it
			// had never been claimed, so a later activation sends it cleanly
			// instead of each row needing reconciliation.
			for _, rest := range claimed[i+1:] {
				w.release(workCtx, rest, reason)
			}
			return len(claimed), errActivationStopped
		}
	}
	return len(claimed), nil
}

// emailBudgetLockID keys the advisory lock serializing budget-checked claims
// across worker instances (nothing else in the app takes advisory locks). The
// value is arbitrary but must stay stable across versions, since overlapping
// instances during a deploy are exactly what it serializes.
const emailBudgetLockID int64 = 0x656d6c627564 // "emlbud"

// claimBatch claims up to BatchSize queued rows, capped at what remains of
// today's (UTC) daily send budget, stamping each claim's attempted_at so the
// attempt durably counts against today even if the row is later requeued.
// The count and the claim run in one transaction under an advisory lock, so
// two overlapping instances (a deploy handing off) can never both spend the
// same remaining slots. With the budget exhausted (or the quota pause armed)
// it claims nothing and logs the pause once per UTC day; queued rows wait for
// an explicit activation on a later eligible day.
func (w *Worker) claimBatch(ctx context.Context) ([]*models.EmailRecipient, error) {
	if w.dispatchPaused() {
		return nil, nil
	}
	if w.quotaPaused() || w.storedQuotaPaused(ctx) {
		w.logBudgetPaused(logger.Data{"reason": "mailgun quota rejection", "limit": w.cfg.DailySendLimit})
		return nil, nil
	}

	// READ COMMITTED is explicit, not inherited from the server default: the
	// budget math relies on the count seeing rows committed while this
	// transaction waited on the advisory lock. Under a stricter default (e.g.
	// REPEATABLE READ) a blocked waiter's snapshot would predate the lock
	// holder's commit and both instances could spend the same remaining slots.
	var claimed []*models.EmailRecipient
	err := w.db.RunInTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted}, func(ctx context.Context, tx bun.Tx) error {
		limit := w.cfg.BatchSize
		if w.cfg.DailySendLimit > 0 {
			// The transaction-scoped advisory lock releases on commit or
			// rollback; it serializes only the count-and-claim, not the sends
			// that follow it.
			if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(?)", emailBudgetLockID); err != nil {
				return errors.Wrap(err, "acquire email budget lock")
			}
			used, err := countAttemptsSince(ctx, tx, startOfUTCDay(w.now()))
			if err != nil {
				return err
			}
			remaining := w.cfg.DailySendLimit - used
			if remaining <= 0 {
				w.logBudgetPaused(logger.Data{"used": used, "limit": w.cfg.DailySendLimit})
				return nil
			}
			if remaining < limit {
				limit = remaining
			}
		}
		err := tx.NewRaw(`
			UPDATE email_recipients SET status = ?, attempted_at = ?, updated_at = now()
			WHERE id IN (
				SELECT id FROM email_recipients
				WHERE status = ?
				ORDER BY created_at ASC, id ASC
				LIMIT ?
				FOR UPDATE SKIP LOCKED
			)
			RETURNING *
		`, models.EmailSending, w.now(), models.EmailQueued, limit).Scan(ctx, &claimed)
		return errors.Wrap(err, "claim queued email recipients")
	})
	if err != nil {
		return nil, err
	}
	return claimed, nil
}

// now is the worker's clock: the injected cfg.Now when set (tests crossing
// UTC midnight), time.Now otherwise.
func (w *Worker) now() time.Time {
	if w.cfg.Now != nil {
		return w.cfg.Now()
	}
	return time.Now()
}

// pauseQuotaUntilTomorrow arms the quota pause: no more dispatches until the
// next UTC midnight, when Mailgun's quota resets. The pause is also saved to
// app_settings, because the machine scales to zero: without it, every restart
// later the same day would re-send into the quota, and each rejection counts
// toward failing the row at the head of the queue (maxQuotaRequeues).
func (w *Worker) pauseQuotaUntilTomorrow(ctx context.Context) {
	until := nextUTCMidnight(w.now())
	w.mu.Lock()
	w.quotaPauseUntil = until
	w.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	setting := &models.AppSetting{Key: models.AppSettingEmailQuotaPausedUntil, Value: until.Format(time.RFC3339)}
	if _, err := w.db.NewInsert().Model(setting).
		On("CONFLICT (key) DO UPDATE").Set("value = EXCLUDED.value").
		Exec(ctx); err != nil {
		w.log.Err(err).Error("email worker could not save the quota pause; it holds only until a restart")
	}
}

// storedQuotaPaused reports whether a quota pause saved by an earlier process
// is still in effect, adopting it in memory when it is. A missing, unreadable,
// or expired value means no pause: failing open here costs at most one more
// quota rejection, which re-arms the pause.
func (w *Worker) storedQuotaPaused(ctx context.Context) bool {
	setting := new(models.AppSetting)
	err := w.db.NewSelect().Model(setting).Where("s.key = ?", models.AppSettingEmailQuotaPausedUntil).Scan(ctx)
	if err != nil {
		if !errors.Is(err, sql.ErrNoRows) {
			w.log.Err(err).Warn("email worker could not read the saved quota pause")
		}
		return false
	}
	until, err := time.Parse(time.RFC3339, setting.Value)
	if err != nil || !w.now().Before(until) {
		return false
	}
	w.mu.Lock()
	w.quotaPauseUntil = until
	w.mu.Unlock()
	return true
}

// pauseDispatch skips claims for dispatchCooldown.
func (w *Worker) pauseDispatch() {
	until := w.now().Add(dispatchCooldown)
	w.mu.Lock()
	w.dispatchPauseUntil = until
	w.mu.Unlock()
}

// dispatchPaused reports whether a stopped activation is still cooling down.
func (w *Worker) dispatchPaused() bool {
	w.mu.Lock()
	until := w.dispatchPauseUntil
	w.mu.Unlock()
	return w.now().Before(until)
}

// recordOutcome tracks consecutive unknown send outcomes; any definitive
// answer from Mailgun (accepted or rejected) resets the count.
func (w *Worker) recordOutcome(unknown bool) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if unknown {
		w.unknownInARow++
	} else {
		w.unknownInARow = 0
	}
}

// unknownStreakReached reports whether the consecutive unknown outcomes have
// reached maxUnknownInARow.
func (w *Worker) unknownStreakReached() bool {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.unknownInARow >= maxUnknownInARow
}

// quotaPaused reports whether a Mailgun quota rejection has paused dispatches
// for the rest of the current UTC day.
func (w *Worker) quotaPaused() bool {
	w.mu.Lock()
	until := w.quotaPauseUntil
	w.mu.Unlock()
	return w.now().Before(until)
}

// logBudgetPaused logs that claims are paused until the next UTC day, at most
// once per UTC day so repeated admin activity does not produce duplicate logs.
func (w *Worker) logBudgetPaused(data logger.Data) {
	day := startOfUTCDay(w.now()).Format("2006-01-02")
	w.mu.Lock()
	already := w.pauseLoggedDay == day
	w.pauseLoggedDay = day
	w.mu.Unlock()
	if !already {
		w.log.Info("email worker daily send budget exhausted; pausing claims until the next UTC day", data)
	}
}

// sendOne renders and dispatches a single claimed row, then records the
// outcome:
//   - A definitive, message-specific Mailgun rejection marks the row failed
//     with its reason (it was provably never accepted).
//   - A quota rejection requeues it and pauses until the next UTC day.
//   - An account refusal (401/403) releases it, with an explanation, and
//     stops: every other row would be refused the same way.
//   - An unknown outcome (5xx, timeout, connection drop) leaves it `sending`
//     for the reconciler, since Mailgun may have accepted the message and
//     marking it failed could misreport a delivered email or invite a
//     duplicate resend. A single one is a blip and the batch carries on; a
//     second in a row stops (see maxUnknownInARow).
//   - A database error loading the row's send, event, or guest releases it and
//     stops: nothing was dispatched, and the database is evidently having
//     trouble, so the row goes back to the queue rather than being failed or
//     left for a reconciler that might mistake it for an interrupted send. A
//     send or guest that no longer exists (deleted, taking the row with it)
//     is simply skipped.
//
// stop tells the caller to release the rest of the claim, with reason as the
// explanation to show on those rows (empty for none).
func (w *Worker) sendOne(ctx context.Context, row *models.EmailRecipient, sends map[string]*models.EmailSend, events map[string]*models.Event) (stop bool, reason string) {
	send, ok := sends[row.SendID]
	if !ok {
		var err error
		send, err = loadSend(ctx, w.db, row.SendID)
		if errcodeIsNotFound(err) {
			// The send was deleted, taking this row with it: nothing to do.
			return false, ""
		}
		if err != nil {
			return w.releaseAfterLoadFailure(ctx, err, row, "load send failed")
		}
		sends[row.SendID] = send
	}

	var event *models.Event
	if eventID := send.RecipientFilter.MergeEventID(); eventID != nil {
		event, ok = events[*eventID]
		if !ok {
			loaded := new(models.Event)
			err := w.db.NewSelect().Model(loaded).Where("e.id = ?", *eventID).Scan(ctx)
			switch {
			case errors.Is(err, sql.ErrNoRows):
				// The event was deleted after the send was queued; its merge
				// fields render empty rather than blocking the send.
				loaded = nil
			case err != nil:
				return w.releaseAfterLoadFailure(ctx, err, row, "load event failed")
			}
			events[*eventID] = loaded
			event = loaded
		}
	}

	guest := new(models.Guest)
	err := w.db.NewSelect().Model(guest).Relation("Party").Where("g.id = ?", row.GuestID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		// A guest deleted between enqueue and pickup cascades the recipient
		// row away with it: nothing left to send or update, and the rest of
		// the batch carries on (guest edits never wake the worker, so
		// stopping here would stall the rest of the send).
		return false, ""
	}
	if err != nil {
		return w.releaseAfterLoadFailure(ctx, err, row, "load guest failed")
	}

	// Re-check subscription at send time for real sends, not just at enqueue: a
	// large send can span two days at the daily send cap, so a guest can
	// unsubscribe after the row was queued but before it is dispatched. Honor it,
	// record the terminal `unsubscribed` status (distinct from a delivery
	// failed), and never call Mailgun (ADR 0009). Test sends are exempt: their
	// row is addressed to the couple's own inbox, not the render guest, so the
	// render guest's subscription is irrelevant to delivery.
	if !send.IsTest && !guest.Subscribed {
		row.Status = models.EmailUnsubscribed
		row.FailureReason = nil
		w.updateRow(ctx, row)
		return false, ""
	}

	mctx := MergeContext{Guest: guest, Party: guest.Party, Event: event, PublicBaseURL: w.cfg.PublicBaseURL}
	// Both bodies carry the same merge-resolved content: Text is the plaintext
	// fallback (the Markdown reduced to readable text, RenderText) and HTML is
	// it rendered to HTML and wrapped in the shell, the same pipeline the
	// compose preview shows (RenderEmail).
	messageID, err := w.client.Send(ctx, Message{
		From:           w.cfg.From,
		ReplyTo:        w.cfg.ReplyTo,
		To:             row.EmailAddress,
		Subject:        Render(send.Subject, mctx),
		Text:           RenderText(send.Body, mctx),
		HTML:           RenderEmail(send.Subject, send.Body, mctx),
		RecipientID:    row.ID,
		UnsubscribeURL: unsubscribeURL(mctx),
	})
	var rejection *RejectionError
	w.recordOutcome(err != nil && !errors.As(err, &rejection))
	if err != nil {
		if rejection != nil {
			if rejection.IsQuotaLimited() {
				// Mailgun says the account's daily quota is spent, which the
				// local count cannot always see (manual dashboard sends).
				// The message was still provably never accepted, so a retry
				// cannot duplicate it; but the problem is the day, not this
				// email, so it goes back to the queue for the next UTC day
				// and dispatches pause until then. The pause arms regardless
				// of how this row is dispositioned below: the answer says the
				// account is quota-limited either way.
				w.pauseQuotaUntilTomorrow(ctx)
				if row.QuotaRequeues >= maxQuotaRequeues {
					// Requeue cap reached: fail the row so a rejection
					// misclassified as quota (or a genuinely stuck account)
					// surfaces as a visible failure with Mailgun's words on
					// the send detail page, instead of stalling the head of
					// the queue forever (see maxQuotaRequeues).
					w.log.Err(err).Warn("mailgun rejected for quota repeatedly; marking row failed", logger.Data{"recipient_id": row.ID, "quota_requeues": row.QuotaRequeues})
					w.markFailed(ctx, row, err.Error())
					return false, ""
				}
				w.log.Err(err).Warn("mailgun rejected for quota; requeueing and pausing until the next UTC day", logger.Data{"recipient_id": row.ID, "quota_requeues": row.QuotaRequeues + 1})
				row.QuotaRequeues++
				w.requeue(ctx, row)
				return false, ""
			}
			if rejection.IsAccountProblem() {
				// Mailgun refused the account, not this email (a bad API key,
				// a domain not allowed to send): every other row would be
				// refused the same way, and failing them all would drop the
				// whole send. Put this one back untouched and stop until the
				// configuration is fixed.
				w.log.Err(err).Error("mailgun refused the account; requeueing and pausing sends until it is fixed", logger.Data{"recipient_id": row.ID})
				w.pauseDispatch()
				reason := fmt.Sprintf(accountProblemReason, "status "+strconv.Itoa(rejection.StatusCode))
				w.release(ctx, row, reason)
				return true, reason
			}
			// Mailgun answered and said no: the message was provably never
			// accepted, so failing the row cannot lose a delivered email.
			w.markFailed(ctx, row, err.Error())
			return false, ""
		}
		// Unknown: the request may or may not have reached Mailgun. Leave the
		// row `sending`; once it ages past StuckThreshold the reconciler
		// settles it against Mailgun's event log (sent if accepted, requeued
		// if not), exactly as it would after a crash.
		w.log.Err(err).Warn("email send outcome unknown; leaving row for reconciliation", logger.Data{"recipient_id": row.ID})
		if w.unknownStreakReached() {
			w.log.Warn("mailgun keeps failing; stopping sends for now", logger.Data{"recipient_id": row.ID})
			w.pauseDispatch()
			return true, ""
		}
		return false, ""
	}

	row.Status = models.EmailSent
	row.MailgunMessageID = pointerutil.String(messageID)
	row.FailureReason = nil
	w.updateRow(ctx, row)
	return false, ""
}

// ReconcileStuck handles rows stranded in `sending` by a crash, kill, or an
// ambiguous send error: any row older than StuckThreshold is checked against
// Mailgun's event log via the recipient_id custom variable. Already-accepted
// rows are marked sent with their message id (never re-sent); unseen rows go
// back to queued for a fresh attempt. A row whose check errors stays
// `sending` and is retried next cycle. Returns how many rows it examined.
//
// A row stuck longer than unconfirmableAfter is failed with an explanation
// instead of requeued when Mailgun has no record of it: the event log only
// reaches back a day on the free plan, and reconciliation only runs when an
// activation happens, which can be days after the interruption.
//
// Mailgun's events API is eventually consistent: in rare cases an accepted
// event can take longer than the stuck threshold to appear, in which case
// the not-found answer here re-sends an accepted message. The effective
// threshold (six minutes under the default tuning) comfortably covers
// Mailgun's typical indexing lag, and the API offers nothing stronger to
// ask.
func (w *Worker) ReconcileStuck(ctx context.Context) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, w.batchBudget())
	defer cancel()

	var stuck []*models.EmailRecipient
	err := w.db.NewSelect().Model(&stuck).
		Where("erc.status = ?", models.EmailSending).
		Where("erc.updated_at < now() - make_interval(secs => ?)", w.effectiveStuckThreshold().Seconds()).
		Order("erc.created_at ASC", "erc.id ASC").
		Scan(ctx)
	if err != nil {
		return 0, errors.Wrap(err, "list stuck email recipients")
	}

	if len(stuck) == 0 {
		return 0, nil
	}
	// The rows' updated_at comes from the database clock, so their age is
	// measured against it too (not the worker's, which tests may fake).
	var dbNow time.Time
	if err := w.db.NewRaw("SELECT now()").Scan(ctx, &dbNow); err != nil {
		return 0, errors.Wrap(err, "read database clock")
	}

	for _, row := range stuck {
		messageID, found, err := w.client.FindAcceptedMessageID(ctx, row.ID, row.EmailAddress)
		if err != nil {
			w.log.Err(err).Error("email worker stuck-row check failed", logger.Data{"recipient_id": row.ID})
			continue
		}
		switch {
		case found:
			row.Status = models.EmailSent
			row.MailgunMessageID = pointerutil.String(messageID)
			row.FailureReason = nil
		case dbNow.Sub(row.UpdatedAt) > unconfirmableAfter:
			// Mailgun's event log may no longer cover this attempt, so not
			// found proves nothing; a requeue could be a second copy.
			w.log.Warn("stuck email is too old to confirm against Mailgun; marking failed", logger.Data{"recipient_id": row.ID})
			w.markFailed(ctx, row, unconfirmableReason)
			continue
		default:
			row.Status = models.EmailQueued
			row.FailureReason = nil
		}
		w.updateRow(ctx, row)
	}
	return len(stuck), nil
}

// effectiveStuckThreshold is StuckThreshold floored at the batch budget plus
// a minute: a row claimed at the start of a slow batch legitimately sits in
// `sending` for up to the whole budget, and a threshold tuned below that
// would let an overlapping instance's reconciler requeue (and double-send) a
// row this worker is still going to reach. The floor keeps the two knobs
// safe to tune independently on one instance; it is computed from the LOCAL
// batch size, so overlapping instances (a deploy handing off) must share the
// same worker tuning or a small-batch instance could still requeue a row a
// large-batch instance has claimed but not yet reached.
func (w *Worker) effectiveStuckThreshold() time.Duration {
	if floor := w.batchBudget() + time.Minute; w.cfg.StuckThreshold < floor {
		return floor
	}
	return w.cfg.StuckThreshold
}

// markFailed records a row's failure reason and flips it to failed. The
// reason is capped and forced to valid UTF-8: it can embed a raw Mailgun
// response body, and an invalid byte sequence (or a multi-byte rune split by
// the cap) would make Postgres reject the write, stranding the row in a
// reconcile-and-fail loop.
func (w *Worker) markFailed(ctx context.Context, row *models.EmailRecipient, reason string) {
	if len(reason) > maxFailureReason {
		reason = reason[:maxFailureReason]
	}
	reason = strings.ToValidUTF8(reason, "")
	row.Status = models.EmailFailed
	row.FailureReason = pointerutil.String(reason)
	w.updateRow(ctx, row)
}

// requeue returns a claimed row to the queue for a later attempt (the quota
// path), through the same guarded write as every other transition, so it can
// never stomp an outcome another instance recorded since. The row keeps its
// attempted_at: the attempt happened and counts against the day it was made
// regardless of the requeue.
func (w *Worker) requeue(ctx context.Context, row *models.EmailRecipient) {
	row.Status = models.EmailQueued
	row.MailgunMessageID = nil
	row.FailureReason = nil
	w.updateRow(ctx, row)
}

// release returns a claimed row the worker never dispatched to the queue, as
// if it had never been claimed: its attempted_at is cleared so the claim does
// not count against today's budget (Mailgun only counts what it accepts).
// reason, when set, is shown on the send detail page while the row waits; a
// later outcome clears or replaces it.
func (w *Worker) release(ctx context.Context, row *models.EmailRecipient, reason string) {
	row.Status = models.EmailQueued
	row.AttemptedAt = nil
	row.MailgunMessageID = nil
	row.FailureReason = nil
	if reason != "" {
		row.FailureReason = pointerutil.String(reason)
	}
	w.updateRow(ctx, row)
}

// releaseAfterLoadFailure handles a row whose send, event, or guest failed to
// load: nothing was dispatched, so it goes back to the queue, and the
// activation stops since the database is evidently having trouble. If even
// the release cannot be written, the row stays `sending` and the reconciler
// settles it later.
func (w *Worker) releaseAfterLoadFailure(ctx context.Context, err error, row *models.EmailRecipient, msg string) (bool, string) {
	w.log.Err(err).Warn("email worker: "+msg+"; requeueing and stopping", logger.Data{"recipient_id": row.ID})
	w.release(ctx, row, "")
	return true, ""
}

// updateRow persists a row's status fields, guarded on the row still being
// `sending` AND on the updated_at it was loaded with: every transition the
// worker writes starts from a claimed or stuck-selected row, and the guards
// keep it from stomping an outcome someone else recorded since. The status
// guard covers the plain cases: the delivery webhook landing via the
// recipient_id fallback before the success path's write commits (downgrading
// a delivered or bounced row back to sent would lose that outcome forever,
// since Mailgun never resends an acknowledged event), or a stale reconciler
// racing a row another instance already sent. The updated_at guard closes
// the ABA hole the status alone cannot see: a stale reconciler's requeue
// landing after the row was already requeued and re-claimed (`sending` again,
// but under a fresh claim) would otherwise pass the status check and queue a
// third send. The write detaches from the batch context (a row whose send
// timed out still needs its outcome written) and takes its own short
// deadline. Errors are logged, not returned: an unwritten row stays
// `sending`, which the reconciler resolves against Mailgun on a later cycle,
// so no email is ever double-sent over a bookkeeping failure.
func (w *Worker) updateRow(ctx context.Context, row *models.EmailRecipient) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	loadedAt := row.UpdatedAt
	row.UpdatedAt = time.Now()
	// quota_requeues and attempted_at ride along on every guarded transition:
	// the quota path increments the counter and release clears attempted_at,
	// and every other path writes back the values the row was loaded with, so
	// neither can be lost or double-counted under the same guards that protect
	// status.
	res, err := w.db.NewUpdate().Model(row).
		Column("status", "mailgun_message_id", "failure_reason", "quota_requeues", "attempted_at", "updated_at").
		WherePK().
		Where("status = ?", models.EmailSending).
		Where("updated_at = ?", loadedAt).
		Exec(ctx)
	if err != nil {
		w.log.Err(err).Error("email worker row update failed", logger.Data{"recipient_id": row.ID})
		return
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		w.log.Warn("recipient row moved on before the status write; left untouched", logger.Data{"recipient_id": row.ID})
	}
}
