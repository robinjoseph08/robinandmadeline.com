package emails

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/golib/pointerutil"
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
	// PublicBaseURL is the site origin the merge-field links are built on.
	PublicBaseURL string
	// BatchSize is how many queued rows one batch claims.
	BatchSize int
	// PollInterval is how long the worker sleeps between cycles when the
	// queue is empty.
	PollInterval time.Duration
	// StuckThreshold is how old a `sending` row must be before the worker's
	// reconcile pass (run each cycle, including immediately on restart)
	// treats it as stuck (left behind by a crash) and checks it against
	// Mailgun. It must comfortably exceed the longest plausible in-flight
	// send so a row a live worker is processing is never touched; the worker
	// enforces that itself by flooring the effective threshold at the batch
	// budget (see effectiveStuckThreshold).
	StuckThreshold time.Duration
}

// perSendBudget is the per-row slice of a batch's time budget: generously
// above the Mailgun client's own 15-second HTTP timeout plus the row's DB
// bookkeeping, so a batch budget of BatchSize*perSendBudget can never expire
// while a row's send is still within its own timeout.
const perSendBudget = 30 * time.Second

// Worker drains the email_recipients queue through Mailgun (ADR 0004). Each
// cycle reconciles stuck `sending` rows, then claims queued rows in batches
// (flipping them to `sending` so a concurrent pickup can never double-send),
// renders each recipient's merge fields, and records `sent` (with the Mailgun
// message id) or `failed` per row.
//
// Shutdown contract: cancel the context passed to Run. The worker stops
// picking up new batches but finishes the batch in flight (its Mailgun and DB
// calls run on a detached context), then Run returns and Done() closes.
type Worker struct {
	db     *bun.DB
	client MailgunClient
	cfg    WorkerConfig
	log    logger.Logger
	done   chan struct{}
}

// NewWorker builds a Worker.
func NewWorker(db *bun.DB, client MailgunClient, cfg WorkerConfig, log logger.Logger) *Worker {
	return &Worker{
		db:     db,
		client: client,
		cfg:    cfg,
		log:    log,
		done:   make(chan struct{}),
	}
}

// Done is closed when Run has returned, letting main wait for the in-flight
// batch before closing the database.
func (w *Worker) Done() <-chan struct{} { return w.done }

// Run loops until ctx is canceled: reconcile stuck rows, drain the queue,
// sleep, repeat. The first cycle runs immediately, so a restart reconciles and
// resumes the queue without waiting out a poll interval. Call it in a
// goroutine; it never returns an error (failures are logged and retried next
// cycle, since the queue must outlive transient Mailgun or DB hiccups).
func (w *Worker) Run(ctx context.Context) {
	defer close(w.done)
	w.log.Info("email worker started")
	for {
		w.cycle(ctx)
		select {
		case <-ctx.Done():
			w.log.Info("email worker stopped")
			return
		case <-time.After(w.cfg.PollInterval):
		}
	}
}

// cycle runs one reconcile pass plus as many batches as the queue holds,
// stopping between batches once ctx is canceled. The work itself runs on a
// context detached from ctx's cancellation so a shutdown never aborts a batch
// midway (the finish-current-batch guarantee); each batch is separately
// time-bounded instead.
func (w *Worker) cycle(ctx context.Context) {
	detached := context.WithoutCancel(ctx)

	if _, err := w.ReconcileStuck(detached); err != nil {
		w.log.Err(err).Error("email worker reconcile failed")
	}

	for {
		n, err := w.ProcessBatch(detached)
		if err != nil {
			w.log.Err(err).Error("email worker batch failed")
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
// rows) and sends each through Mailgun, recording sent or failed per row. It
// returns how many rows it claimed; zero means the queue is empty.
func (w *Worker) ProcessBatch(ctx context.Context) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, w.batchBudget())
	defer cancel()

	var claimed []*models.EmailRecipient
	err := w.db.NewRaw(`
		UPDATE email_recipients SET status = ?, updated_at = now()
		WHERE id IN (
			SELECT id FROM email_recipients
			WHERE status = ?
			ORDER BY created_at ASC, id ASC
			LIMIT ?
			FOR UPDATE SKIP LOCKED
		)
		RETURNING *
	`, models.EmailSending, models.EmailQueued, w.cfg.BatchSize).Scan(ctx, &claimed)
	if err != nil {
		return 0, errors.Wrap(err, "claim queued email recipients")
	}
	if len(claimed) == 0 {
		return 0, nil
	}

	// Batches can span sends; cache each send and its filter event once.
	sends := map[string]*models.EmailSend{}
	events := map[string]*models.Event{}
	for _, row := range claimed {
		w.sendOne(ctx, row, sends, events)
	}
	return len(claimed), nil
}

// sendOne renders and dispatches a single claimed row, then records the
// outcome. Failures never propagate: a definitive Mailgun rejection marks the
// row failed with its reason and the batch moves on; an ambiguous send error
// (timeout, connection drop) leaves the row `sending` for the reconciler,
// since Mailgun may have accepted the message and marking it failed could
// both misreport a delivered email and invite a duplicate manual resend.
// Failures loading the row's context (send, event, guest) also leave it
// `sending`: nothing was dispatched, so the reconciler's not-found answer
// requeues it for free, where a `failed` mark would turn a transient database
// blip into a permanent failure the admin must manually re-send.
func (w *Worker) sendOne(ctx context.Context, row *models.EmailRecipient, sends map[string]*models.EmailSend, events map[string]*models.Event) {
	send, ok := sends[row.SendID]
	if !ok {
		var err error
		send, err = loadSend(ctx, w.db, row.SendID)
		if err != nil {
			w.leaveForReconciliation(err, row, "load send failed")
			return
		}
		sends[row.SendID] = send
	}

	var event *models.Event
	if eventID := send.RecipientFilter.EventID; eventID != nil {
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
				w.leaveForReconciliation(err, row, "load event failed")
				return
			}
			events[*eventID] = loaded
			event = loaded
		}
	}

	guest := new(models.Guest)
	err := w.db.NewSelect().Model(guest).Relation("Party").Where("g.id = ?", row.GuestID).Scan(ctx)
	if err != nil {
		// A guest deleted between enqueue and pickup cascades the recipient
		// row away with it, so there is nothing left to update either way;
		// a transient failure leaves the row for the reconciler like the
		// rest.
		w.leaveForReconciliation(err, row, "load guest failed")
		return
	}

	mctx := MergeContext{Guest: guest, Party: guest.Party, Event: event, PublicBaseURL: w.cfg.PublicBaseURL}
	messageID, err := w.client.Send(ctx, Message{
		From:        w.cfg.From,
		To:          row.EmailAddress,
		Subject:     Render(send.Subject, mctx),
		Text:        Render(send.Body, mctx),
		RecipientID: row.ID,
	})
	if err != nil {
		var rejection *RejectionError
		if errors.As(err, &rejection) {
			// Mailgun answered and said no: the message was provably never
			// accepted, so failing the row cannot lose a delivered email.
			w.markFailed(ctx, row, err.Error())
			return
		}
		// Ambiguous: the request may or may not have reached Mailgun. Leave
		// the row `sending`; once it ages past StuckThreshold the reconciler
		// settles it against Mailgun's event log (sent if accepted, requeued
		// if not), exactly as it would after a crash.
		w.log.Err(err).Warn("email send outcome unknown; leaving row for reconciliation", logger.Data{"recipient_id": row.ID})
		return
	}

	row.Status = models.EmailSent
	row.MailgunMessageID = pointerutil.String(messageID)
	row.FailureReason = nil
	w.updateRow(ctx, row)
}

// ReconcileStuck handles rows stranded in `sending` by a crash, kill, or an
// ambiguous send error: any row older than StuckThreshold is checked against
// Mailgun's event log via the recipient_id custom variable. Already-accepted
// rows are marked sent with their message id (never re-sent); unseen rows go
// back to queued for a fresh attempt. A row whose check errors stays
// `sending` and is retried next cycle. Returns how many rows it examined.
//
// Mailgun's events API is eventually consistent: in rare cases an accepted
// event can take longer than StuckThreshold to appear, in which case the
// not-found answer here re-sends an accepted message. The threshold default
// (five minutes) comfortably covers Mailgun's typical indexing lag, and the
// API offers nothing stronger to ask.
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

	for _, row := range stuck {
		messageID, found, err := w.client.FindAcceptedMessageID(ctx, row.ID, row.EmailAddress)
		if err != nil {
			w.log.Err(err).Error("email worker stuck-row check failed", logger.Data{"recipient_id": row.ID})
			continue
		}
		if found {
			row.Status = models.EmailSent
			row.MailgunMessageID = pointerutil.String(messageID)
			row.FailureReason = nil
		} else {
			row.Status = models.EmailQueued
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
// safe to tune independently.
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
	const maxReason = 1000
	if len(reason) > maxReason {
		reason = reason[:maxReason]
	}
	reason = strings.ToValidUTF8(reason, "")
	row.Status = models.EmailFailed
	row.FailureReason = pointerutil.String(reason)
	w.updateRow(ctx, row)
}

// leaveForReconciliation logs a row whose outcome could not be determined (or
// whose context failed to load) and leaves it `sending` on purpose: once it
// ages past the stuck threshold the reconciler settles it against Mailgun's
// event log, marking it sent if a message was accepted and requeueing it for
// a fresh attempt if not.
func (w *Worker) leaveForReconciliation(err error, row *models.EmailRecipient, msg string) {
	w.log.Err(err).Warn("email worker: "+msg+"; leaving row for reconciliation", logger.Data{"recipient_id": row.ID})
}

// updateRow persists a row's status fields, guarded on the row still being
// `sending`: every transition the worker writes starts from a claimed row,
// and the guard keeps it from stomping an outcome someone else recorded
// first. The delivery webhook can land via the recipient_id fallback before
// the success path's write commits (downgrading a delivered or bounced row
// back to sent would lose that outcome forever, since Mailgun never resends
// an acknowledged event), and a stale reconciler racing an overlapping
// instance must not requeue a row that instance already sent. The write
// detaches from the batch context (a row whose send timed out still needs
// its outcome written) and takes its own short deadline. Errors are logged,
// not returned: an unwritten row stays `sending`, which the reconciler
// resolves against Mailgun on a later cycle, so no email is ever double-sent
// over a bookkeeping failure.
func (w *Worker) updateRow(ctx context.Context, row *models.EmailRecipient) {
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancel()
	row.UpdatedAt = time.Now()
	res, err := w.db.NewUpdate().Model(row).
		Column("status", "mailgun_message_id", "failure_reason", "updated_at").
		WherePK().
		Where("status = ?", models.EmailSending).
		Exec(ctx)
	if err != nil {
		w.log.Err(err).Error("email worker row update failed", logger.Data{"recipient_id": row.ID})
		return
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		w.log.Warn("recipient row moved on before the status write; left untouched", logger.Data{"recipient_id": row.ID})
	}
}
