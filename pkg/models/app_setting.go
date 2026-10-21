package models

import "github.com/uptrace/bun"

// Well-known app_settings keys. The values are free-form text whose format is
// owned by the reader: rsvp_deadline holds an RFC3339 timestamp, contact_email
// an email address. An absent row is a valid state (no deadline set, no
// contact email configured).
const (
	// AppSettingRSVPDeadline is the last moment RSVPs stay open (the reader
	// closes them only strictly after it), stored as an RFC3339 timestamp.
	// Absent means RSVPs stay open indefinitely.
	AppSettingRSVPDeadline = "rsvp_deadline"
	// AppSettingContactEmail is the address shown to guests in the
	// post-deadline "contact us" message.
	AppSettingContactEmail = "contact_email"
	// AppSettingEmailQuotaPausedUntil is owned by the email worker, not the
	// admin settings page: after Mailgun rejects a send for quota, it holds the
	// next UTC midnight (RFC3339) so the pause survives a scale-to-zero restart.
	// Absent or past means sending is not paused.
	AppSettingEmailQuotaPausedUntil = "email_quota_paused_until"
)

// AppSetting is one site-wide key/value setting (e.g. the RSVP deadline or the
// contact email). The admin settings page edits these; feature packages read
// the keys they care about.
type AppSetting struct {
	bun.BaseModel `bun:"table:app_settings,alias:s" tstype:"-"`

	Key   string `bun:"key,pk" json:"key"`
	Value string `bun:"value" json:"value"`
}
