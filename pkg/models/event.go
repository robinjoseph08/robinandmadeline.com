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
// DATE); StartTime/EndTime are nullable "HH:MM" strings, which sort lexically
// in chronological order and so double as the schedule's display order.
// Location is a free-form display label; LocationURL, when set, is the link the
// schedule renders that label as (a map or directions page) and is only ever
// present alongside a Location (the events service rejects a link with no label).
type Event struct {
	bun.BaseModel `bun:"table:events,alias:e" tstype:"-"`

	ID          string  `bun:"id,pk" json:"id"`
	Name        string  `bun:"name" json:"name"`
	Description *string `bun:"description" json:"description"`
	Location    *string `bun:"location" json:"location"`
	LocationURL *string `bun:"location_url" json:"location_url"`
	Date        string  `bun:"date" json:"date"`
	StartTime   *string `bun:"start_time" json:"start_time"`
	EndTime     *string `bun:"end_time" json:"end_time"`
	IsPublic    bool    `bun:"is_public" json:"is_public"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`
}
