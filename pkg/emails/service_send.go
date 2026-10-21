package emails

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// Preview resolves the filter and renders the subject/body for the first
// matching recipient, the compose page's pre-send check. With no recipients
// the sample fields are empty and the (zero) totals tell the story.
func (s *Service) Preview(ctx context.Context, in PreviewEmailPayload) (*PreviewEmailResponse, error) {
	res, err := s.ResolveRecipients(ctx, in.Filter)
	if err != nil {
		return nil, err
	}
	recipients := res.Recipients
	event, err := s.filterEvent(ctx, in.Filter)
	if err != nil {
		return nil, err
	}
	// Today's (UTC) dispatch count, so the confirm step can warn when the
	// send exceeds what is left of the daily budget and will span days.
	used, err := countAttemptsSince(ctx, s.db, startOfUTCDay(time.Now()))
	if err != nil {
		return nil, err
	}

	// Normalize the warnings to a non-nil slice so the JSON surface serializes
	// [] rather than null (mergeFieldProblems returns a nil slice when there are
	// none), matching the package's list-envelope convention and letting the
	// compose page read .length without a guard.
	warnings := mergeFieldProblems(in.Subject, in.Body, event, recipients)
	if warnings == nil {
		warnings = []MergeFieldWarning{}
	}
	// Surface WHO is excluded, and why, not just the counts, so the admin can
	// verify the exclusions: no-email and unsubscribed are separate buckets.
	resp := &PreviewEmailResponse{
		Recipients:          make([]PreviewRecipient, 0, len(recipients)),
		Total:               len(recipients),
		SkippedNoEmail:      len(res.SkippedNoEmail),
		Skipped:             skippedRecipients(res.SkippedNoEmail),
		SkippedUnsubscribed: len(res.SkippedUnsubscribed),
		Unsubscribed:        skippedRecipients(res.SkippedUnsubscribed),
		Warnings:            warnings,
		DailySendLimit:      s.dailySendLimit,
		DailySendsUsed:      used,
	}
	for _, g := range recipients {
		item := PreviewRecipient{GuestID: g.ID, GuestName: g.FullName}
		if g.Email != nil {
			item.EmailAddress = strings.TrimSpace(*g.Email)
		}
		if g.Party != nil {
			item.PartyName = g.Party.Name
		}
		resp.Recipients = append(resp.Recipients, item)
	}

	if len(recipients) > 0 {
		sample := recipients[0]
		mctx := MergeContext{Guest: sample, Party: sample.Party, Event: event, PublicBaseURL: s.publicBaseURL}
		resp.SampleGuestName = sample.FullName
		resp.SampleSubject = Render(in.Subject, mctx)
		// The plaintext sample is the plain-text version a send carries; the HTML
		// sample is that source rendered to HTML and wrapped in the email shell,
		// so the admin previews the real email (RenderEmail, shell.go).
		resp.SampleBody = RenderText(in.Body, mctx)
		resp.SampleHTML = RenderEmail(in.Subject, in.Body, mctx)
	}
	return resp, nil
}

// CreateSend records the send and fans out one queued email_recipients row per
// matching guest, all in one transaction, then returns immediately: the actual
// dispatch happens asynchronously in the Worker (ADR 0004). The subject/body
// are snapshotted as sent; template_id is provenance only but must name an
// existing template when present. A filter matching no recipients is a 422:
// there is nothing to send.
//
// With a request_id, a repeat of an earlier request (a retry after a lost
// response) returns the send that request created, with its current stats,
// and queues nothing new; see replaySend.
func (s *Service) CreateSend(ctx context.Context, in SendEmailPayload) (*models.EmailSend, SendStats, error) {
	if in.RequestID != nil {
		if send, stats, found, err := s.replaySend(ctx, in); found || err != nil {
			return send, stats, err
		}
	}
	if in.TemplateID != nil {
		if _, err := loadTemplate(ctx, s.db, *in.TemplateID); err != nil {
			if errcodeIsNotFound(err) {
				return nil, SendStats{}, errcodes.ValidationError("The selected template no longer exists.")
			}
			return nil, SendStats{}, err
		}
	}

	res, err := s.ResolveRecipients(ctx, in.Filter)
	if err != nil {
		return nil, SendStats{}, err
	}
	recipients := res.Recipients
	if len(recipients) == 0 {
		return nil, SendStats{}, errcodes.ValidationError("No recipients with an email address match the filter.")
	}

	// The hard backstop behind the compose-page warnings: a blank merge field
	// must be impossible to dispatch, so even a direct API call is refused when
	// any referenced field would render empty (the filter does not select
	// exactly one event, or a recipient has no RSVP code). The event for merge
	// fields is the filter's.
	event, err := s.filterEvent(ctx, in.Filter)
	if err != nil {
		return nil, SendStats{}, err
	}
	if problems := mergeFieldProblems(in.Subject, in.Body, event, recipients); len(problems) > 0 {
		return nil, SendStats{}, errcodes.ValidationError("This email would send a blank merge field: " + joinProblems(problems))
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
		RequestID:       in.RequestID,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
	rows := make([]*models.EmailRecipient, 0, len(recipients))
	for _, g := range recipients {
		rows = append(rows, &models.EmailRecipient{
			ID:           newID(),
			SendID:       send.ID,
			GuestID:      g.ID,
			EmailAddress: strings.TrimSpace(*g.Email),
			Status:       models.EmailQueued,
			CreatedAt:    now,
			UpdatedAt:    now,
		})
	}

	err = s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(send).Exec(ctx); err != nil {
			// The template existence pre-check above runs before this
			// transaction; a template deleted in between trips the
			// template_id foreign key here (ON DELETE SET NULL only covers
			// deletes after the insert), the same retryable race as the
			// recipients insert below.
			if errcodes.IsForeignKeyViolation(err) {
				return errcodes.ValidationError("The selected template no longer exists.")
			}
			if in.RequestID != nil && errcodes.IsUniqueViolation(err) {
				return errDuplicateRequest
			}
			return errors.Wrap(err, "insert email send")
		}
		if _, err := tx.NewInsert().Model(&rows).Exec(ctx); err != nil {
			// A guest deleted between resolving the recipients and this insert
			// trips the guest_id foreign key; that is a stale-audience race the
			// admin can retry, not an infrastructure failure.
			if errcodes.IsForeignKeyViolation(err) {
				return errcodes.ValidationError("A matching guest was just deleted; preview again and retry.")
			}
			return errors.Wrap(err, "insert email recipients")
		}
		return nil
	})
	if errors.Is(err, errDuplicateRequest) {
		// The same request committed concurrently (a double submit racing
		// itself); answer with the send it created.
		send, stats, found, err := s.replaySend(ctx, in)
		if err == nil && !found {
			err = errors.New("email send request id conflicted but no send was found")
		}
		return send, stats, err
	}
	if err != nil {
		return nil, SendStats{}, err
	}
	// RunInTx has committed before it returns nil. Signal only now so a worker
	// can never race ahead of the durable recipient rows or run for a rollback.
	s.wakeWorker()
	return send, SendStats{Queued: len(rows), Total: len(rows)}, nil
}

// errDuplicateRequest marks a send insert that lost the race for its
// request_id to a concurrent copy of the same request.
var errDuplicateRequest = errors.New("email send request already recorded")

// replaySend looks up the send an earlier request with in.RequestID created.
// found is false when there is none. A match with the same content is a retry:
// it returns that send and its current stats. A match with different content
// means the key was reused for a different email (the draft changed after an
// attempt whose response was lost); that is a 409 rather than a silent replay,
// so the admin checks the history before sending again.
func (s *Service) replaySend(ctx context.Context, in SendEmailPayload) (*models.EmailSend, SendStats, bool, error) {
	send := new(models.EmailSend)
	err := s.db.NewSelect().Model(send).Where("es.request_id = ?", *in.RequestID).Scan(ctx)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, SendStats{}, false, nil
	}
	if err != nil {
		return nil, SendStats{}, false, errors.Wrap(err, "load email send by request id")
	}
	if send.Subject != in.Subject || send.Body != in.Body || !sameFilter(send.RecipientFilter, in.Filter) {
		return nil, SendStats{}, true, errcodes.Conflict("An earlier attempt of this send already went out with different content. Check the send history before sending again.")
	}
	stats, err := s.SendStatsBySendIDs(ctx, []string{send.ID})
	if err != nil {
		return nil, SendStats{}, true, err
	}
	return send, stats[send.ID], true, nil
}

// sameFilter compares two recipient filters by their JSON form, the shape they
// are stored in, so an absent slice and an empty one compare equal.
func sameFilter(a, b models.RecipientFilter) bool {
	aj, errA := json.Marshal(a)
	bj, errB := json.Marshal(b)
	return errA == nil && errB == nil && bytes.Equal(aj, bj)
}

// ListSends returns every send, newest first, and the total count.
func (s *Service) ListSends(ctx context.Context) ([]*models.EmailSend, int, error) {
	var sends []*models.EmailSend
	total, err := s.db.NewSelect().Model(&sends).
		Order("es.sent_at DESC", "es.id DESC").
		ScanAndCount(ctx)
	if err != nil {
		return nil, 0, errors.Wrap(err, "list email sends")
	}
	return sends, total, nil
}

// GetSendDetail returns one send with its recipient rows (each with guest and
// party context loaded, ordered by creation), or a 404.
func (s *Service) GetSendDetail(ctx context.Context, id string) (*models.EmailSend, []*models.EmailRecipient, error) {
	send, err := loadSend(ctx, s.db, id)
	if err != nil {
		return nil, nil, err
	}
	var recipients []*models.EmailRecipient
	err = s.db.NewSelect().Model(&recipients).
		Relation("Guest").Relation("Guest.Party").
		Where("erc.send_id = ?", id).
		Order("erc.created_at ASC", "erc.id ASC").
		Scan(ctx)
	if err != nil {
		return nil, nil, errors.Wrap(err, "list email recipients")
	}
	return send, recipients, nil
}

// SendStatsBySendIDs tallies the recipient rows by status for the given sends
// in one grouped query, returning a map keyed by send id. A send with no rows
// maps to the zero stats. With no ids it returns an empty map.
func (s *Service) SendStatsBySendIDs(ctx context.Context, sendIDs []string) (map[string]SendStats, error) {
	stats := make(map[string]SendStats, len(sendIDs))
	if len(sendIDs) == 0 {
		return stats, nil
	}

	var tallies []struct {
		SendID string `bun:"send_id"`
		Status string `bun:"status"`
		Count  int    `bun:"count"`
	}
	err := s.db.NewSelect().Model((*models.EmailRecipient)(nil)).
		Column("send_id", "status").ColumnExpr("count(*) AS count").
		Where("send_id IN (?)", bun.List(sendIDs)).
		Group("send_id", "status").
		Scan(ctx, &tallies)
	if err != nil {
		return nil, errors.Wrap(err, "tally email recipients")
	}

	for _, t := range tallies {
		st := stats[t.SendID]
		switch t.Status {
		case models.EmailQueued:
			st.Queued = t.Count
		case models.EmailSending:
			st.Sending = t.Count
		case models.EmailSent:
			st.Sent = t.Count
		case models.EmailDelivered:
			st.Delivered = t.Count
		case models.EmailBounced:
			st.Bounced = t.Count
		case models.EmailFailed:
			st.Failed = t.Count
		case models.EmailUnsubscribed:
			st.Unsubscribed = t.Count
		}
		st.Total += t.Count
		stats[t.SendID] = st
	}
	return stats, nil
}

// filterEvent loads the event the filter names for merge-field rendering (see
// RecipientFilter.MergeEventID). No event filter, several events, or an event
// id that no longer exists yields nil: in the last case the EXISTS filter
// already matches no guests, so an empty merge value is moot.
func (s *Service) filterEvent(ctx context.Context, f models.RecipientFilter) (*models.Event, error) {
	eventID := f.MergeEventID()
	if eventID == nil {
		return nil, nil
	}
	event := new(models.Event)
	err := s.db.NewSelect().Model(event).Where("e.id = ?", *eventID).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, errors.Wrap(err, "load filter event")
	}
	return event, nil
}

// skippedRecipients projects excluded guests onto the API view the compose page
// shows. Shared by both excluded buckets (no email, and unsubscribed).
func skippedRecipients(guests []*models.Guest) []SkippedRecipient {
	items := make([]SkippedRecipient, 0, len(guests))
	for _, g := range guests {
		item := SkippedRecipient{GuestID: g.ID, GuestName: g.FullName}
		if g.Party != nil {
			item.PartyName = g.Party.Name
		}
		items = append(items, item)
	}
	return items
}

// errcodeIsNotFound reports whether err is an errcodes 404, letting CreateSend
// translate a missing template reference into a validation error while real
// infrastructure failures pass through.
func errcodeIsNotFound(err error) bool {
	var e *errcodes.Error
	return errors.As(err, &e) && e.Code == string(errcodes.CodeNotFound)
}
