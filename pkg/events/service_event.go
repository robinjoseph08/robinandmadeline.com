package events

import (
	"context"
	"database/sql"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// CreateEvent inserts an event. Creating a public event backfills a pending
// Event RSVP for every existing guest in the same transaction (ADR 0002: a
// public event invites everyone, and the row is the invitation), so a failed
// backfill rolls the event back too. A private event invites nobody until
// parties are invited explicitly. The payload is already bound, trimmed,
// defaulted, and validated by the binder, so the fields are assigned directly.
func (s *Service) CreateEvent(ctx context.Context, in CreateEventPayload) (*models.Event, error) {
	now := time.Now()
	event := &models.Event{
		ID:          newID(),
		Name:        in.Name,
		Description: in.Description,
		Location:    in.Location,
		Date:        in.Date,
		StartTime:   in.StartTime,
		EndTime:     in.EndTime,
		IsPublic:    in.IsPublic,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if _, err := tx.NewInsert().Model(event).Exec(ctx); err != nil {
			return errors.Wrap(err, "insert event")
		}
		if event.IsPublic {
			return backfillAllGuests(ctx, tx, event.ID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return event, nil
}

// GetEvent loads a single event, or a 404.
func (s *Service) GetEvent(ctx context.Context, id string) (*models.Event, error) {
	return loadEvent(ctx, s.db, id)
}

// ListEvents returns every event and the total count, in schedule order: date
// first, then start_time (zero-padded "HH:MM" strings sort lexically in
// chronological order, and Postgres puts NULLs last under ASC, so untimed
// events trail their day's timed ones), then id as a stable tiebreak. There
// are at most a handful of events, so the list takes no filters.
func (s *Service) ListEvents(ctx context.Context) ([]*models.Event, int, error) {
	var list []*models.Event
	total, err := s.db.NewSelect().Model(&list).
		Order("e.date ASC", "e.start_time ASC", "e.id ASC").
		ScanAndCount(ctx)
	if err != nil {
		return nil, 0, errors.Wrap(err, "list events")
	}
	return list, total, nil
}

// UpdateEvent applies the editable fields to an existing event (PUT-style). A
// missing event is a 404. Flipping is_public from false to true backfills
// pending Event RSVPs for every guest in the same transaction, restoring the
// public-event invariant (ADR 0002); flipping to private leaves existing rows
// untouched so no response is lost to a visibility toggle.
func (s *Service) UpdateEvent(ctx context.Context, id string, in UpdateEventPayload) (*models.Event, error) {
	event := new(models.Event)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		// Load inside the tx so the public-flip detection and the backfill see a
		// consistent row.
		loaded, err := loadEvent(ctx, tx, id)
		if err != nil {
			return err
		}
		*event = *loaded
		becamePublic := !event.IsPublic && in.IsPublic

		// The payload is already bound, trimmed, defaulted, and validated by the
		// binder, so the fields are assigned directly. An omitted optional field
		// is nil and persists as SQL NULL.
		event.Name = in.Name
		event.Description = in.Description
		event.Location = in.Location
		event.Date = in.Date
		event.StartTime = in.StartTime
		event.EndTime = in.EndTime
		event.IsPublic = in.IsPublic
		event.UpdatedAt = time.Now()

		if _, err := tx.NewUpdate().Model(event).
			Column("name", "description", "location", "date", "start_time",
				"end_time", "is_public", "updated_at").
			WherePK().Exec(ctx); err != nil {
			return errors.Wrap(err, "update event")
		}

		if becamePublic {
			return backfillAllGuests(ctx, tx, event.ID)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return event, nil
}

// DeleteEvent removes an event; its Event RSVP rows go via the FK cascade.
// Deleting a non-existent event returns a 404.
func (s *Service) DeleteEvent(ctx context.Context, id string) error {
	res, err := s.db.NewDelete().Model((*models.Event)(nil)).Where("id = ?", id).Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "delete event")
	}
	n, err := res.RowsAffected()
	if err != nil {
		return errors.Wrap(err, "delete event rows affected")
	}
	if n == 0 {
		return errcodes.NotFound("event")
	}
	return nil
}

// backfillAllGuests creates a pending Event RSVP row for every guest on one
// event, skipping guests that already have one. It runs inside the caller's
// transaction (event create, or the update that flips an event public) so the
// invited set appears atomically with the event change.
func backfillAllGuests(ctx context.Context, db bun.IDB, eventID string) error {
	guestIDs, err := allGuestIDs(ctx, db)
	if err != nil {
		return err
	}
	return insertPendingRSVPs(ctx, db, []string{eventID}, guestIDs)
}
