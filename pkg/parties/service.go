package parties

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/uptrace/bun"
	"github.com/uptrace/bun/driver/pgdriver"
)

// Sentinel errors returned by the service. Handlers map these to HTTP statuses
// (see handlers.go): ErrNotFound -> 404, ErrConflict -> 409, ErrRequiredFields
// -> 422, ErrValidation -> 400. Using sentinels keeps the service free of any
// HTTP concern.
var (
	// ErrNotFound is returned when a party or guest does not exist.
	ErrNotFound = errors.New("not found")
	// ErrConflict is returned when a unique value (info_token, rsvp_code) is
	// already taken.
	ErrConflict = errors.New("unique conflict")
	// ErrRequiredFields is returned by MarkComplete (and info-form submission)
	// when the party is missing fields required to be complete.
	ErrRequiredFields = errors.New("required fields missing")
	// ErrValidation is returned for invalid input (bad enum, empty name, etc.).
	// It wraps a more specific message describing the offending field.
	ErrValidation = errors.New("validation failed")
)

// pgUniqueViolation is the SQLSTATE code Postgres returns for a unique
// constraint violation. We detect it on the driver error to translate insert /
// update conflicts into ErrConflict.
const pgUniqueViolation = "23505"

// maxTokenAttempts bounds info-token generation retries on the (vanishingly
// unlikely) event a freshly generated token collides with an existing one.
const maxTokenAttempts = 5

// Service is the parties/guests data layer over a Bun DB. Construct it with
// NewService. It owns all writes, so the single-primary and status invariants
// have exactly one enforcement point.
type Service struct {
	db *bun.DB
}

// NewService builds a Service backed by the given Bun DB.
func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

// validationErr wraps a message as an ErrValidation so callers can
// errors.Is(err, ErrValidation) while still seeing the specific reason.
func validationErr(msg string) error {
	return fmt.Errorf("%w: %s", ErrValidation, msg)
}

// isUniqueViolation reports whether err is a Postgres unique-constraint
// violation, which the service surfaces as ErrConflict.
func isUniqueViolation(err error) bool {
	var pgErr pgdriver.Error
	if errors.As(err, &pgErr) {
		return pgErr.Field('C') == pgUniqueViolation
	}
	return false
}

// newID returns a fresh UUIDv7 string. v7 is time-ordered, which keeps inserts
// index-friendly and makes IDs roughly sortable by creation time.
func newID() string {
	return uuid.Must(uuid.NewV7()).String()
}

// loadPartyWithGuests fetches a party and its guests within a query context
// (the receiver may be the DB or a transaction). Returns ErrNotFound when the
// party does not exist. Guests are needed to derive status and to enforce the
// single-primary invariant.
func loadPartyWithGuests(ctx context.Context, db bun.IDB, id string) (*Party, error) {
	party := new(Party)
	err := db.NewSelect().Model(party).Relation("Guests").Where("p.id = ?", id).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("load party: %w", err)
	}
	return party, nil
}
