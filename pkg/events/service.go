// Package events is the admin API and data layer for events and their Event
// RSVPs. An Event RSVP row is the invitation (ADR 0002): public events hold a
// pending row for every guest, private events only for explicitly invited
// parties, and this package owns every write that keeps that invariant true
// (event CRUD, party invites, the admin status override, and the backfill the
// guest-create paths call). The persistent models live in pkg/models; this
// package owns the service writes, request/response types (types.go), and HTTP
// handlers.
package events

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"
	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// Service is the events/event-RSVPs data layer over a Bun DB. Construct it
// with NewService. It owns all event_rsvps writes, so the row-is-the-invitation
// invariant (ADR 0002) has exactly one enforcement point. Methods return
// errcodes errors directly; handlers pass them through to the shared error
// handler.
type Service struct {
	db *bun.DB
}

// NewService builds a Service backed by the given Bun DB.
func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

// newID returns a fresh UUIDv7 string. v7 is time-ordered, which keeps inserts
// index-friendly and makes IDs roughly sortable by creation time.
func newID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// loadEvent fetches an event within a query context (the receiver may be the
// DB or a transaction). Returns a 404 when the event does not exist.
func loadEvent(ctx context.Context, db bun.IDB, id string) (*models.Event, error) {
	event := new(models.Event)
	err := db.NewSelect().Model(event).Where("e.id = ?", id).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("event")
		}
		return nil, errors.Wrap(err, "load event")
	}
	return event, nil
}

// insertPendingRSVPs bulk-inserts pending Event RSVP rows for every (event,
// guest) pair, skipping pairs that already have a row (ON CONFLICT on the
// unique (event_id, guest_id) index), so every auto-creation path is
// idempotent and never disturbs an existing response. It takes a bun.IDB so
// each caller runs it inside its own transaction, keeping the backfill atomic
// with its parent operation (ADR 0002). With no events or no guests it is a
// no-op.
func insertPendingRSVPs(ctx context.Context, db bun.IDB, eventIDs, guestIDs []string) error {
	if len(eventIDs) == 0 || len(guestIDs) == 0 {
		return nil
	}
	now := time.Now()
	rows := make([]*models.EventRSVP, 0, len(eventIDs)*len(guestIDs))
	for _, eventID := range eventIDs {
		for _, guestID := range guestIDs {
			rows = append(rows, &models.EventRSVP{
				ID:        newID(),
				EventID:   eventID,
				GuestID:   guestID,
				Status:    models.RSVPPending,
				CreatedAt: now,
				UpdatedAt: now,
			})
		}
	}
	_, err := db.NewInsert().Model(&rows).
		On("CONFLICT (event_id, guest_id) DO NOTHING").
		Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "insert pending event rsvps")
	}
	return nil
}

// allGuestIDs returns the id of every guest, the target set for a public
// event's backfill.
func allGuestIDs(ctx context.Context, db bun.IDB) ([]string, error) {
	var ids []string
	err := db.NewSelect().Model((*models.Guest)(nil)).Column("id").Scan(ctx, &ids)
	if err != nil {
		return nil, errors.Wrap(err, "list guest ids")
	}
	return ids, nil
}

// publicEventIDs returns the id of every public event, the target set for a
// new guest's backfill.
func publicEventIDs(ctx context.Context, db bun.IDB) ([]string, error) {
	var ids []string
	err := db.NewSelect().Model((*models.Event)(nil)).Column("id").Where("is_public = TRUE").Scan(ctx, &ids)
	if err != nil {
		return nil, errors.Wrap(err, "list public event ids")
	}
	return ids, nil
}

// BackfillPublicEventRSVPs creates a pending Event RSVP row for each given
// guest on every public event, skipping rows that already exist. The
// guest-create paths in pkg/parties call it with their own transaction so a
// new guest's invitations to all public events appear atomically with the
// guest itself (ADR 0002); a failure rolls the whole create back.
func BackfillPublicEventRSVPs(ctx context.Context, db bun.IDB, guestIDs ...string) error {
	eventIDs, err := publicEventIDs(ctx, db)
	if err != nil {
		return err
	}
	return insertPendingRSVPs(ctx, db, eventIDs, guestIDs)
}
