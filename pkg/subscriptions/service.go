// Package subscriptions is the guest-facing Email Subscription flow: the
// unsubscribe and resubscribe endpoints behind the per-guest link in every
// email footer (ADR 0009). Like the info flow it mounts on the open /api group
// with no JWT; the guest's own UUID in the URL is the entire authentication, and
// an unguessable random UUID is all a low-stakes unsubscribe action needs.
package subscriptions

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

// Service reads and writes a guest's Email Subscription. It holds only the DB
// handle; the guest id carried in each request is the whole authorization.
type Service struct {
	db *bun.DB
}

// NewService builds the subscriptions service.
func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

// Subscription returns the guest-facing subscription view for the given guest
// id, or a 404 for an unknown or malformed id (a stale or mistyped link).
func (s *Service) Subscription(ctx context.Context, guestID string) (*SubscriptionResponse, error) {
	guest, err := s.loadGuest(ctx, guestID)
	if err != nil {
		return nil, err
	}
	return newSubscriptionResponse(guest), nil
}

// SetSubscription sets the guest's subscription flag and returns the refreshed
// view. It is idempotent (setting the current value rewrites the same row), so
// the page button, the one-click List-Unsubscribe header, and the admin edit can
// all call it without first reading the state. An unknown or malformed id is a
// 404.
func (s *Service) SetSubscription(ctx context.Context, guestID string, subscribed bool) (*SubscriptionResponse, error) {
	guest, err := s.loadGuest(ctx, guestID)
	if err != nil {
		return nil, err
	}
	guest.Subscribed = subscribed
	guest.UpdatedAt = time.Now()
	if _, err := s.db.NewUpdate().Model(guest).Column("subscribed", "updated_at").WherePK().Exec(ctx); err != nil {
		return nil, errors.Wrap(err, "update guest subscription")
	}
	return newSubscriptionResponse(guest), nil
}

// loadGuest loads a guest by id. Ids are UUIDs, so a malformed one can never
// name a row; parsing it first turns a bad link into the same 404 a missing
// guest gets, instead of a failing text-to-uuid cast that would render a 500.
// This mirrors parties.pathID, kept local since that helper is unexported.
func (s *Service) loadGuest(ctx context.Context, guestID string) (*models.Guest, error) {
	id, err := uuid.Parse(guestID)
	if err != nil {
		return nil, errcodes.NotFound("guest")
	}
	guest := new(models.Guest)
	if err := s.db.NewSelect().Model(guest).Where("g.id = ?", id.String()).Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("guest")
		}
		return nil, errors.Wrap(err, "load guest")
	}
	return guest, nil
}
