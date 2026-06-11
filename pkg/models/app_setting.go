package models

import "github.com/uptrace/bun"

// Well-known app_settings keys. The values are free-form text whose format is
// owned by the reader: rsvp_deadline holds an RFC3339 timestamp, contact_email
// an email address. An absent row is a valid state (no deadline set, no
// contact email configured).
const (
	// AppSettingRSVPDeadline is the moment the RSVP window closes, stored as an
	// RFC3339 timestamp. Absent means RSVPs stay open indefinitely.
	AppSettingRSVPDeadline = "rsvp_deadline"
	// AppSettingContactEmail is the address shown to guests in the
	// post-deadline "contact us" message.
	AppSettingContactEmail = "contact_email"
)

// AppSetting is one site-wide key/value setting (e.g. the RSVP deadline or the
// contact email). The admin dashboard edits these; feature packages read the
// keys they care about.
type AppSetting struct {
	bun.BaseModel `bun:"table:app_settings,alias:s" tstype:"-"`

	Key   string `bun:"key,pk" json:"key"`
	Value string `bun:"value" json:"value"`
}
