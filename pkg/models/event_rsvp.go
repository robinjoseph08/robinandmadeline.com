package models

import (
	"time"

	"github.com/uptrace/bun"
)

// Event RSVP status values, stored as TEXT guarded by a CHECK constraint (like
// parties.side/relation). A row is born pending; attending/not_attending are
// the two possible responses. The //tygo:emit line generates the matching
// TypeScript union.
const (
	//tygo:emit export type EventRSVPStatus = typeof RSVPPending | typeof RSVPAttending | typeof RSVPNotAttending;
	RSVPPending      = "pending"
	RSVPAttending    = "attending"
	RSVPNotAttending = "not_attending"
)

// EventRSVP is a guest's response to a single event. The existence of a row is
// what marks the guest as invited to that event (ADR 0002): public events get
// rows for all guests, private events only for invited parties, and a fresh
// row starts pending.
//
// RSVPedAt records when the response was given (by the guest, or by the admin
// overriding on their behalf); it is NULL while the row is pending. (event_id,
// guest_id) is unique: one Event RSVP per guest per event.
type EventRSVP struct {
	bun.BaseModel `bun:"table:event_rsvps,alias:er" tstype:"-"`

	ID      string `bun:"id,pk" json:"id"`
	EventID string `bun:"event_id" json:"event_id"`
	GuestID string `bun:"guest_id" json:"guest_id"`
	Status  string `bun:"status" json:"status" tstype:"EventRSVPStatus"`

	RSVPedAt *time.Time `bun:"rsvped_at" json:"rsvped_at"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`

	// Event and Guest are populated only when explicitly loaded; they are ORM
	// relations over the FKs, not stored columns. Both are omitted from JSON:
	// responses surface guest/party context through the events package's
	// response types, not nested models.
	Event *Event `bun:"rel:belongs-to,join:event_id=id" json:"-" tstype:"-"`
	Guest *Guest `bun:"rel:belongs-to,join:guest_id=id" json:"-" tstype:"-"`
}
