package emails

import (
	"context"
	"database/sql"
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
	recipients, skipped, err := s.ResolveRecipients(ctx, in.Filter)
	if err != nil {
		return nil, err
	}
	event, err := s.filterEvent(ctx, in.Filter)
	if err != nil {
		return nil, err
	}

	resp := &PreviewEmailResponse{
		Recipients:     make([]PreviewRecipient, 0, len(recipients)),
		Total:          len(recipients),
		SkippedNoEmail: skipped,
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
		resp.SampleBody = Render(in.Body, mctx)
	}
	return resp, nil
}

// CreateSend records the send and fans out one queued email_recipients row per
// matching guest, all in one transaction, then returns immediately: the actual
// dispatch happens asynchronously in the Worker (ADR 0004). The subject/body
// are snapshotted as sent; template_id is provenance only but must name an
// existing template when present. A filter matching no recipients is a 422:
// there is nothing to send.
func (s *Service) CreateSend(ctx context.Context, in SendEmailPayload) (*models.EmailSend, SendStats, error) {
	if in.TemplateID != nil {
		if _, err := loadTemplate(ctx, s.db, *in.TemplateID); err != nil {
			if errcodeIsNotFound(err) {
				return nil, SendStats{}, errcodes.ValidationError("The selected template no longer exists.")
			}
			return nil, SendStats{}, err
		}
	}

	recipients, _, err := s.ResolveRecipients(ctx, in.Filter)
	if err != nil {
		return nil, SendStats{}, err
	}
	if len(recipients) == 0 {
		return nil, SendStats{}, errcodes.ValidationError("No recipients with an email address match the filter.")
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
	if err != nil {
		return nil, SendStats{}, err
	}
	return send, SendStats{Queued: len(rows), Total: len(rows)}, nil
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
		}
		st.Total += t.Count
		stats[t.SendID] = st
	}
	return stats, nil
}

// filterEvent loads the event named in the filter for merge-field rendering.
// No event filter, or an event id that no longer exists, yields nil: in the
// latter case the EXISTS filter already matches no guests, so an empty merge
// value is moot.
func (s *Service) filterEvent(ctx context.Context, f models.RecipientFilter) (*models.Event, error) {
	if f.EventID == nil {
		return nil, nil
	}
	event := new(models.Event)
	err := s.db.NewSelect().Model(event).Where("e.id = ?", *f.EventID).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, errors.Wrap(err, "load filter event")
	}
	return event, nil
}

// errcodeIsNotFound reports whether err is an errcodes 404, letting CreateSend
// translate a missing template reference into a validation error while real
// infrastructure failures pass through.
func errcodeIsNotFound(err error) bool {
	var e *errcodes.Error
	return errors.As(err, &e) && e.Code == string(errcodes.CodeNotFound)
}
