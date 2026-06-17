package settings

// This file is the single home for the package's request and response types:
// handlers never use anonymous structs, echo.Map, or map[string]any. Each
// payload doubles as the service input.

// Response is the body of GET /api/admin/settings and of a successful PUT: the
// full set of app settings the dashboard reads and writes. Every field is a
// pointer so an unset setting (an absent app_settings row) is distinguishable
// from one explicitly set to blank: a nil value means "not configured" (no
// deadline, no contact email), which is a valid state.
//
// rsvp_deadline is an RFC3339 timestamp (the moment the RSVP window closes);
// contact_email is the address shown to guests in the post-deadline message.
type Response struct {
	RSVPDeadline *string `json:"rsvp_deadline"`
	ContactEmail *string `json:"contact_email"`
}

// UpdateSettingsPayload is the body of PUT /api/admin/settings. Like the info
// form's partial fields, every setting is optional and updated independently:
// an absent field (nil) leaves the stored setting untouched, a present field is
// written, and a present-but-blank field clears the setting (deletes its row),
// returning it to the unset state. This lets the dashboard save one field
// without having to resend the others, and lets it clear a deadline or contact
// email without a separate delete endpoint.
//
// rsvp_deadline must parse as an RFC3339 timestamp (the custom datetimeblank
// validator); contact_email must be a valid email address (emailblank). Both
// custom validators also permit a blank value, which is the clear gesture
// (omitempty skips an absent nil pointer; a present blank passes the validator
// and the service then deletes the row). A malformed value is a 422, never a
// 500.
type UpdateSettingsPayload struct {
	RSVPDeadline *string `json:"rsvp_deadline" mod:"trim" validate:"omitempty,datetimeblank"`
	ContactEmail *string `json:"contact_email" mod:"trim" validate:"omitempty,emailblank,max=320"`
}
