package models

import (
	"time"

	"github.com/uptrace/bun"
)

// PhotoGroup is a named set of guests needed together for a specific photo,
// with a shooting order (the photographer's shot list). All group photos
// happen in the one session between the ceremony and the reception, so groups
// form a single global list rather than belonging to an event.
//
// SortOrder is the group's position within that list. New groups are appended
// (max + 1) and the reorder endpoint rewrites the whole sequence, so values
// stay small but are not guaranteed contiguous after deletes; display
// positions ("group 3") are computed by ranking on sort_order, never by
// reading the raw value.
type PhotoGroup struct {
	bun.BaseModel `bun:"table:photo_groups,alias:pg" tstype:"-"`

	ID        string `bun:"id,pk" json:"id"`
	Name      string `bun:"name" json:"name"`
	SortOrder int    `bun:"sort_order" json:"sort_order"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`
}

// PhotoGroupAssignment is one guest's membership in one photo group. The
// composite (photo_group_id, guest_id) primary key is the natural key: a guest
// is in a group at most once, and re-adding is an idempotent no-op.
type PhotoGroupAssignment struct {
	bun.BaseModel `bun:"table:photo_group_assignments,alias:pga" tstype:"-"`

	PhotoGroupID string `bun:"photo_group_id,pk" json:"photo_group_id"`
	GuestID      string `bun:"guest_id,pk" json:"guest_id"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`

	// Guest is populated only when explicitly loaded (the admin list joins it
	// for the guest/party context). It is omitted from JSON: responses surface
	// guest context through the photogroups package's response types.
	Guest *Guest `bun:"rel:belongs-to,join:guest_id=id" json:"-" tstype:"-"`
}
