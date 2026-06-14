package errcodes

import (
	"errors"

	"github.com/uptrace/bun/driver/pgdriver"
)

// pgUniqueViolation is the SQLSTATE Postgres returns for a unique-constraint
// violation.
const pgUniqueViolation = "23505"

// pgForeignKeyViolation is the SQLSTATE Postgres returns for a foreign-key
// violation.
const pgForeignKeyViolation = "23503"

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

// IsForeignKeyViolation reports whether err is a Postgres foreign-key
// violation, for writes that race a referenced row's deletion (an insert
// naming a guest deleted between resolve and insert) and want to surface it
// as a client error rather than a 500.
func IsForeignKeyViolation(err error) bool {
	var pgErr pgdriver.Error
	if errors.As(err, &pgErr) {
		return pgErr.Field('C') == pgForeignKeyViolation
	}
	return false
}

// ConflictOnConstraint is ConflictOnUnique narrowed to one named constraint,
// for statements that can violate more than one unique index and want a
// distinct message (or no 409 at all) per index. A unique violation on a
// different constraint, or any other error, passes through unchanged.
func ConflictOnConstraint(err error, constraint, msg string) error {
	var pgErr pgdriver.Error
	if errors.As(err, &pgErr) && pgErr.Field('C') == pgUniqueViolation && pgErr.Field('n') == constraint {
		return Conflict(msg)
	}
	return err
}
