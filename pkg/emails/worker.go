package emails

import (
	"context"
	"database/sql"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/logger"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// WorkerConfig tunes the queue worker.
type WorkerConfig struct {
	// BatchSize is how many queued rows one batch claims.
	BatchSize int
	// PollInterval is how long the worker sleeps between cycles when the
	// queue is empty.
	PollInterval time.Duration
	// StuckThreshold is how old a `sending` row must be before the
	// reconciler treats it as stuck (left behind by a crash) and checks it
	// against Mailgun. It must comfortably exceed the longest plausible
	// in-flight send so a row a live worker is processing is never touched.
	StuckThreshold time.Duration
}

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
	db            *bun.DB
	client        MailgunClient
	from          string
	publicBaseURL string
	cfg           WorkerConfig
	log           logger.Logger
	done          chan struct{}
}

// NewWorker builds a Worker. from is the sender address on every email;
// publicBaseURL feeds the merge-field links.
func NewWorker(db *bun.DB, client MailgunClient, from, publicBaseURL string, cfg WorkerConfig, log logger.Logger) *Worker {
	return &Worker{
		db:            db,
		client:        client,
		from:          from,
		publicBaseURL: publicBaseURL,
		cfg:           cfg,
		log:           log,
		done:          make(chan struct{}),
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

// ProcessBatch claims up to BatchSize queued rows (atomically flipping them to
// `sending`, with SKIP LOCKED so a concurrent claimer can never grab the same
// rows) and sends each through Mailgun, recording sent or failed per row. It
// returns how many rows it claimed; zero means the queue is empty.
func (w *Worker) ProcessBatch(ctx context.Context) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
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
// outcome. Failures never propagate: the row is marked failed with its reason
// and the batch moves on.
func (w *Worker) sendOne(ctx context.Context, row *models.EmailRecipient, sends map[string]*models.EmailSend, events map[string]*models.Event) {
	send, ok := sends[row.SendID]
	if !ok {
		var err error
		send, err = loadSend(ctx, w.db, row.SendID)
		if err != nil {
			w.markFailed(ctx, row, "load send: "+err.Error())
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
				w.markFailed(ctx, row, "load event: "+err.Error())
				return
			}
			events[*eventID] = loaded
			event = loaded
		}
	}

	guest := new(models.Guest)
	err := w.db.NewSelect().Model(guest).Relation("Party").Where("g.id = ?", row.GuestID).Scan(ctx)
	if err != nil {
		// A guest deleted between enqueue and pickup cascades the row away, so
		// this is either that race or a real failure; both read as failed (the
		// update below simply no-ops if the row is gone).
		w.markFailed(ctx, row, "load guest: "+err.Error())
		return
	}

	mctx := MergeContext{Guest: guest, Party: guest.Party, Event: event, PublicBaseURL: w.publicBaseURL}
	messageID, err := w.client.Send(ctx, Message{
		From:        w.from,
		To:          row.EmailAddress,
		Subject:     Render(send.Subject, mctx),
		Text:        Render(send.Body, mctx),
		RecipientID: row.ID,
	})
	if err != nil {
		w.markFailed(ctx, row, err.Error())
		return
	}

	row.Status = models.EmailSent
	row.MailgunMessageID = pointerutil.String(messageID)
	row.FailureReason = nil
	w.updateRow(ctx, row)
}

// ReconcileStuck handles rows stranded in `sending` by a crash or kill: any
// row older than StuckThreshold is checked against Mailgun's event log via the
// recipient_id custom variable. Already-accepted rows are marked sent with
// their message id (never re-sent); unseen rows go back to queued for a fresh
// attempt. A row whose check errors stays `sending` and is retried next cycle.
// Returns how many rows it examined.
func (w *Worker) ReconcileStuck(ctx context.Context) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	var stuck []*models.EmailRecipient
	err := w.db.NewSelect().Model(&stuck).
		Where("erc.status = ?", models.EmailSending).
		Where("erc.updated_at < now() - make_interval(secs => ?)", w.cfg.StuckThreshold.Seconds()).
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

// markFailed records a row's failure reason and flips it to failed.
func (w *Worker) markFailed(ctx context.Context, row *models.EmailRecipient, reason string) {
	const maxReason = 1000
	if len(reason) > maxReason {
		reason = reason[:maxReason]
	}
	row.Status = models.EmailFailed
	row.FailureReason = pointerutil.String(reason)
	w.updateRow(ctx, row)
}

// updateRow persists a row's status fields. Errors are logged, not returned:
// a failed status write leaves the row `sending`, which the stuck-row
// reconciler will resolve against Mailgun on a later cycle, so no email is
// ever double-sent over a bookkeeping failure.
func (w *Worker) updateRow(ctx context.Context, row *models.EmailRecipient) {
	row.UpdatedAt = time.Now()
	_, err := w.db.NewUpdate().Model(row).
		Column("status", "mailgun_message_id", "failure_reason", "updated_at").
		WherePK().Exec(ctx)
	if err != nil {
		w.log.Err(err).Error("email worker row update failed", logger.Data{"recipient_id": row.ID})
	}
}
