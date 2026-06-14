// Package emails is the admin email system: reusable templates, recipient
// filtering over the guest list, merge-field rendering, and the
// database-backed send queue (ADR 0004). A send snapshots its subject/body and
// filter onto email_sends, fans out one queued email_recipients row per
// matching guest, and returns immediately; the background Worker drains the
// queue through Mailgun, and the webhook handler upgrades delivery statuses.
// The persistent models live in pkg/models; this package owns the service
// writes, request/response types (types.go), HTTP handlers, the worker, and
// the Mailgun client.
package emails

import (
	"context"
	"database/sql"

	"github.com/google/uuid"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// Service is the email templates/sends data layer over a Bun DB. Construct it
// with NewService. Methods return errcodes errors directly; handlers pass them
// through to the shared error handler.
type Service struct {
	db *bun.DB
	// publicBaseURL is the origin merge-field links are built on
	// ({{rsvp_link}}, {{info_link}}).
	publicBaseURL string
	// sentBy is recorded on every send's audit row. There is a single admin
	// account, so it is the configured admin username rather than a claim.
	sentBy string
	// dailySendLimit is the worker's per-UTC-day dispatch budget, surfaced on
	// previews so the compose page can warn when a send will span multiple
	// days. Zero or negative means unlimited.
	dailySendLimit int

	// The "Send test" capability (SendTest). A test send is a real send
	// enqueued for the worker (addressed to the couple's own inboxes), so the
	// service no longer dispatches it itself and needs no Mailgun client or
	// From here: it only needs the recipient inboxes and a flag for whether the
	// capability is on. Both are zero/false when Mailgun is off (WithTestSend is
	// never called), in which case SendTest cleanly 422s.
	testSendEnabled bool
	testRecipients  []string
}

// NewService builds a Service backed by the given Bun DB. publicBaseURL is the
// site origin used to build merge-field links; sentBy is the admin username
// recorded on sends; dailySendLimit is the worker's per-UTC-day dispatch
// budget (zero or negative for unlimited), reported on previews. The test-send
// capability is off until WithTestSend is called.
func NewService(db *bun.DB, publicBaseURL, sentBy string, dailySendLimit int) *Service {
	return &Service{db: db, publicBaseURL: publicBaseURL, sentBy: sentBy, dailySendLimit: dailySendLimit}
}

// WithTestSend enables the "Send test" endpoint with the configured test
// recipients (the couple's own inboxes). A test send is enqueued for the queue
// worker like any real send, so this needs no Mailgun client of its own. It
// returns the same Service for fluent wiring. Called only when Mailgun is
// configured (so the worker is on to drain the test send); without it SendTest
// 422s.
func (s *Service) WithTestSend(testRecipients []string) *Service {
	s.testSendEnabled = true
	s.testRecipients = testRecipients
	return s
}

// newID returns a fresh UUIDv7 string, time-ordered like the rest of the
// app's ids.
func newID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// loadTemplate fetches a template within a query context. Returns a 404 when
// it does not exist.
func loadTemplate(ctx context.Context, db bun.IDB, id string) (*models.EmailTemplate, error) {
	tpl := new(models.EmailTemplate)
	err := db.NewSelect().Model(tpl).Where("et.id = ?", id).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("email template")
		}
		return nil, errors.Wrap(err, "load email template")
	}
	return tpl, nil
}

// loadSend fetches a send within a query context. Returns a 404 when it does
// not exist.
func loadSend(ctx context.Context, db bun.IDB, id string) (*models.EmailSend, error) {
	send := new(models.EmailSend)
	err := db.NewSelect().Model(send).Where("es.id = ?", id).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("email send")
		}
		return nil, errors.Wrap(err, "load email send")
	}
	return send, nil
}
