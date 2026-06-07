package errcodes

import (
	"errors"

	"github.com/uptrace/bun/driver/pgdriver"
)

// pgUniqueViolation is the SQLSTATE Postgres returns for a unique-constraint
// violation.
const pgUniqueViolation = "23505"

// IsUniqueViolation reports whether err is a Postgres unique-constraint
// violation. It is the single place that detection lives so stores route insert
// and update conflicts through ConflictOnUnique rather than inspecting the
// driver error themselves.
func IsUniqueViolation(err error) bool {
	var pgErr pgdriver.Error
	if errors.As(err, &pgErr) {
		return pgErr.Field('C') == pgUniqueViolation
	}
	return false
}

// ConflictOnUnique returns a Conflict(msg) when err is a Postgres
// unique-constraint violation, and the original err otherwise. Callers wrap a
// failing insert/update with it to surface a 409 for duplicates while passing
// other errors through unchanged.
func ConflictOnUnique(err error, msg string) error {
	if IsUniqueViolation(err) {
		return Conflict(msg)
	}
	return err
}
