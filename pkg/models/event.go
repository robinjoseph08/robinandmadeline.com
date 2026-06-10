package models

import (
	"time"

	"github.com/uptrace/bun"
)

// Event is a scheduled wedding activity (Rehearsal Dinner / Madhuram Veppu,
// Ceremony, Reception, possibly Brunch).
//
// IsPublic decides invitation semantics (ADR 0002): a public event is visible
// to everyone on the schedule and every guest holds an Event RSVP row for it; a
// private event is visible only to guests whose parties were explicitly
// invited. Date travels as a "YYYY-MM-DD" string (the column is a Postgres
// DATE); StartTime/EndTime are nullable "HH:MM" strings. SortOrder drives the
// schedule's display order.
type Event struct {
	bun.BaseModel `bun:"table:events,alias:e" tstype:"-"`

	ID          string  `bun:"id,pk" json:"id"`
	Name        string  `bun:"name" json:"name"`
	Description *string `bun:"description" json:"description"`
	Location    *string `bun:"location" json:"location"`
	Date        string  `bun:"date" json:"date"`
	StartTime   *string `bun:"start_time" json:"start_time"`
	EndTime     *string `bun:"end_time" json:"end_time"`
	IsPublic    bool    `bun:"is_public" json:"is_public"`
	SortOrder   int     `bun:"sort_order" json:"sort_order"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`
}
