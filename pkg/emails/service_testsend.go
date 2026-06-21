package emails

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// SendTest enqueues the draft as a REAL send through the queue and worker, just
// addressed to the couple's own inboxes (EMAIL_TEST_RECIPIENTS) so they can
// eyeball the email in their mail client. Making it a real send is the whole
// point: it reuses the daily-quota counting, the delivery webhook, and the send
// history (flagged is_test) for free, rather than re-implementing them on a
// separate synchronous path.
//
// The trick that lets one queue row both render real copy and reach a test
// inbox: the worker renders each row's merge fields from its guest_id but sends
// to its email_address (a snapshot). So SendTest picks the FIRST guest matching
// the filter as the render source (its name, RSVP code, and links populate the
// merge fields) and writes one recipient row per configured test inbox, each
// pointing at that render guest but addressed to the inbox. The filter's event
// drives the event merge fields exactly as a real send's does.
//
// Because it is a real send, the same merge-field emptiness validation a real
// send enforces applies: a test must not render a blank merge field either, so
// a draft referencing {{event_name}}/{{event_date}} with no event filter, or
// {{rsvp_code}} when the render guest's party has no code, is a 422. It does NOT
// touch the daily-budget counter directly: the worker stamps attempted_at when
// it dispatches, so the test send counts against the day automatically.
//
// A 422 results when the test capability is off (Mailgun not configured), when
// no test recipients are configured, or when no guest matches the filter to
// render from.
func (s *Service) SendTest(ctx context.Context, in TestEmailPayload) (*TestEmailResponse, error) {
	if !s.testSendEnabled {
		return nil, errcodes.ValidationError("Email sending is not configured.")
	}
	if len(s.testRecipients) == 0 {
		return nil, errcodes.ValidationError("No test recipients are configured.")
	}

	// A test send renders from the first guest matching the filter (each list is
	// ordered by guest creation). Prefer a recipient (has an email and is
	// subscribed): a real send only ever renders for those guests, so rendering
	// the test from one mirrors the copy a real send would actually produce. Fall
	// back to any matched-but-excluded guest (no email, or unsubscribed) since the
	// render guest's own address and subscription are irrelevant here (the row is
	// addressed to the test inbox, and the worker exempts test sends from the
	// subscription re-check). With no match at all there is nothing to render
	// from, so it is a 422.
	res, err := s.ResolveRecipients(ctx, in.Filter)
	if err != nil {
		return nil, err
	}
	var renderGuest *models.Guest
	switch {
	case len(res.Recipients) > 0:
		renderGuest = res.Recipients[0]
	case len(res.SkippedNoEmail) > 0:
		renderGuest = res.SkippedNoEmail[0]
	case len(res.SkippedUnsubscribed) > 0:
		renderGuest = res.SkippedUnsubscribed[0]
	default:
		return nil, errcodes.ValidationError("No guests match the filter to render a test from.")
	}

	// The same backstop a real send applies: a blank merge field must be
	// impossible to dispatch. Validate against the single render guest plus the
	// filter's event (one event per send), reusing the real send's helper so the
	// rules can never drift.
	event, err := s.filterEvent(ctx, in.Filter)
	if err != nil {
		return nil, err
	}
	if problems := mergeFieldProblems(in.Subject, in.Body, event, []*models.Guest{renderGuest}); len(problems) > 0 {
		return nil, errcodes.ValidationError("This test would send a blank merge field: " + joinProblems(problems))
	}

	now := time.Now()
	send := &models.EmailSend{
		ID:              newID(),
		TemplateID:      in.TemplateID,
		Subject:         in.Subject,
		Body:            in.Body,
		RecipientFilter: in.Filter,
		SentAt:          now,
		SentBy:          s.sentBy,
		IsTest:          true,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	// One queued row per configured test inbox, all rendering from the same
	// render guest but each addressed to its inbox, so the worker sends a fully
	// merged email to every test address.
	rows := make([]*models.EmailRecipient, 0, len(s.testRecipients))
	for _, to := range s.testRecipients {
		rows = append(rows, &models.EmailRecipient{
			ID:           newID(),
			SendID:       send.ID,
			GuestID:      renderGuest.ID,
			EmailAddress: strings.TrimSpace(to),
			Status:       models.EmailQueued,
			CreatedAt:    now,
			UpdatedAt:    now,
		})
	}

	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(send).Exec(ctx); err != nil {
			if errcodes.IsForeignKeyViolation(err) {
				return errcodes.ValidationError("The selected template no longer exists.")
			}
			return errors.Wrap(err, "insert test email send")
		}
		if _, err := tx.NewInsert().Model(&rows).Exec(ctx); err != nil {
			// The render guest deleted between resolving and this insert trips the
			// guest_id foreign key, the same stale-audience race CreateSend maps.
			if errcodes.IsForeignKeyViolation(err) {
				return errcodes.ValidationError("A matching guest was just deleted; preview again and retry.")
			}
			return errors.Wrap(err, "insert test email recipients")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &TestEmailResponse{SendID: send.ID, Queued: len(rows)}, nil
}

// The sample merge entities the dev shell-preview endpoint (ShellPreviewHTML)
// renders against, so every field resolves to a realistic value and the preview
// email is never blank. The test send no longer uses these: it renders from a
// real guest so the couple previews the real copy.

func sampleGuest() *models.Guest {
	return &models.Guest{FullName: "Alex Sample"}
}

func sampleParty() *models.Party {
	return &models.Party{
		Name:      "The Sample Party",
		InfoToken: "sampletoken",
		RSVPCode:  pointerutil.String("SAMPL"),
	}
}

func sampleEvent() *models.Event {
	return &models.Event{Name: "Sample Reception", Date: "2026-10-17"}
}
