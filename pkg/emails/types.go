package emails

import "github.com/robinjoseph08/robinandmadeline.com/pkg/models"

// This file is the single home for the package's request, response, and
// enum-carrying payload types: handlers never use anonymous structs, echo.Map,
// or map[string]any. Each payload doubles as the service input.

// CreateTemplatePayload is the body for POST /emails/templates. subject and
// body may contain merge field placeholders ({{guest_name}} etc.), which stay
// unresolved on the template and render per recipient at send time. body is
// deliberately not trimmed: leading/trailing whitespace can be meaningful in a
// plain-text email.
type CreateTemplatePayload struct {
	Name    string `json:"name" mod:"trim" validate:"required,max=200"`
	Subject string `json:"subject" mod:"trim" validate:"required,max=500"`
	Body    string `json:"body" validate:"required,max=50000"`
}

// UpdateTemplatePayload is the full desired state of a template's editable
// fields (PUT-style), mirroring CreateTemplatePayload.
type UpdateTemplatePayload struct {
	Name    string `json:"name" mod:"trim" validate:"required,max=200"`
	Subject string `json:"subject" mod:"trim" validate:"required,max=500"`
	Body    string `json:"body" validate:"required,max=50000"`
}

// TemplateResponse is the API representation of a template (the stored model;
// no derived fields today).
type TemplateResponse struct {
	models.EmailTemplate `tstype:",extends"`
}

// ListTemplatesResponse is the uniform list envelope for templates.
type ListTemplatesResponse struct {
	Items []TemplateResponse `json:"items"`
	Total int                `json:"total"`
}

// PreviewEmailPayload is the body for POST /emails/preview: the composed
// subject/body plus the recipient filter, exactly what a send would carry.
// The nested filter's fields are validated by the same tags a send validates.
type PreviewEmailPayload struct {
	Subject string                 `json:"subject" mod:"trim" validate:"required,max=500"`
	Body    string                 `json:"body" validate:"required,max=50000"`
	Filter  models.RecipientFilter `json:"filter" tstype:"models.RecipientFilter"`
}

// PreviewRecipient is one matched guest in a preview: just enough to show who
// the send would go to.
type PreviewRecipient struct {
	GuestID      string `json:"guest_id"`
	GuestName    string `json:"guest_name"`
	EmailAddress string `json:"email_address"`
	PartyName    string `json:"party_name"`
}

// MergeFieldWarning flags a merge field referenced in the draft that would
// resolve empty for at least one recipient: an {{event_name}}/{{event_date}}
// with no event selected in the filter, or an {{rsvp_code}} for recipients
// whose party has no code. Field is the bare field name (e.g. "rsvp_code");
// Message is the admin-facing explanation. The preview returns these as a
// non-fatal list so the compose page can show them and disable Send; CreateSend
// turns the same problems into a hard 422 so a blank merge field can never be
// dispatched even through a direct API call.
type MergeFieldWarning struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// SkippedRecipient is a guest excluded from a send, surfaced so the admin can
// verify the exclusions rather than only seeing a count. The preview groups
// these by reason: no email address, or unsubscribed (ADR 0009).
type SkippedRecipient struct {
	GuestID   string `json:"guest_id"`
	GuestName string `json:"guest_name"`
	PartyName string `json:"party_name"`
}

// PreviewEmailResponse is what the compose page renders before sending: the
// matched recipients, the two excluded buckets (guests with no email address,
// and guests who unsubscribed, each as both a count and who they are), and the
// subject/body with merge fields resolved for the first recipient (the sample),
// as both an HTML email (shell-wrapped) and a plaintext fallback. With no
// recipients the sample fields are empty. DailySendLimit and DailySendsUsed
// describe the worker's per-UTC-day dispatch budget so the confirm step can warn
// when a send will span multiple days; a non-positive limit means unlimited.
// Warnings lists merge fields that would resolve empty for some recipient, so
// the page can disable Send until the draft or filter is fixed (it is empty,
// never null).
type PreviewEmailResponse struct {
	Recipients          []PreviewRecipient  `json:"recipients"`
	Total               int                 `json:"total"`
	SkippedNoEmail      int                 `json:"skipped_no_email"`
	Skipped             []SkippedRecipient  `json:"skipped"`
	SkippedUnsubscribed int                 `json:"skipped_unsubscribed"`
	Unsubscribed        []SkippedRecipient  `json:"unsubscribed"`
	SampleGuestName     string              `json:"sample_guest_name"`
	SampleSubject       string              `json:"sample_subject"`
	SampleBody          string              `json:"sample_body"`
	SampleHTML          string              `json:"sample_html"`
	Warnings            []MergeFieldWarning `json:"warnings"`
	DailySendLimit      int                 `json:"daily_send_limit"`
	DailySendsUsed      int                 `json:"daily_sends_used"`
}

// SendEmailPayload is the body for POST /emails/send. template_id is
// provenance only (the subject/body here are what is sent, since the admin may
// have edited them after loading the template); when present it must name an
// existing template.
type SendEmailPayload struct {
	TemplateID *string                `json:"template_id" validate:"omitempty,uuid"`
	Subject    string                 `json:"subject" mod:"trim" validate:"required,max=500"`
	Body       string                 `json:"body" validate:"required,max=50000"`
	Filter     models.RecipientFilter `json:"filter" tstype:"models.RecipientFilter"`
}

// TestEmailPayload is the body for POST /emails/test: the current draft to
// send to the couple's own inboxes (EMAIL_TEST_RECIPIENTS). It mirrors the send
// payload so the same composed copy is testable. A test send is a REAL send
// through the queue and worker, just addressed to the couple's inboxes and
// rendered from the FIRST guest matching the filter, so the same emptiness
// validation a real send enforces applies (a test must not render a blank merge
// field either). template_id is optional provenance; the filter both selects
// the render guest and drives the event merge fields.
type TestEmailPayload struct {
	TemplateID *string                `json:"template_id" validate:"omitempty,uuid"`
	Subject    string                 `json:"subject" mod:"trim" validate:"required,max=500"`
	Body       string                 `json:"body" validate:"required,max=50000"`
	Filter     models.RecipientFilter `json:"filter" tstype:"models.RecipientFilter"`
}

// TestEmailResponse reports the test send the draft was enqueued as: its id (so
// the compose page can open the send detail to watch delivery) and how many
// recipient rows were queued (one per configured test inbox).
type TestEmailResponse struct {
	SendID string `json:"send_id"`
	Queued int    `json:"queued"`
}

// SendStats is a send's tally of recipient rows by delivery status. Total is
// the recipient count.
type SendStats struct {
	Queued       int `json:"queued"`
	Sending      int `json:"sending"`
	Sent         int `json:"sent"`
	Delivered    int `json:"delivered"`
	Bounced      int `json:"bounced"`
	Failed       int `json:"failed"`
	Unsubscribed int `json:"unsubscribed"`
	Total        int `json:"total"`
}

// SendResponse is the API representation of a send: the stored model plus its
// derived per-status recipient stats.
type SendResponse struct {
	models.EmailSend `tstype:",extends"`
	Stats            SendStats `json:"stats"`
}

// ListSendsResponse is the uniform list envelope for sends.
type ListSendsResponse struct {
	Items []SendResponse `json:"items"`
	Total int            `json:"total"`
}

// SendRecipientItem is one recipient row in a send's detail, with the guest
// and party context the admin UI shows. A recipient whose guest has since been
// deleted never appears: the FK cascade removes the row with the guest.
type SendRecipientItem struct {
	models.EmailRecipient `tstype:",extends"`
	GuestName             string `json:"guest_name"`
	PartyName             string `json:"party_name"`
}

// SendDetailResponse is the send detail page's shape: the send, its stats, and
// every recipient row.
type SendDetailResponse struct {
	models.EmailSend `tstype:",extends"`
	Stats            SendStats           `json:"stats"`
	Recipients       []SendRecipientItem `json:"recipients"`
}

// newTemplateResponse wraps a template for the API.
func newTemplateResponse(t *models.EmailTemplate) TemplateResponse {
	return TemplateResponse{EmailTemplate: *t}
}

// newSendResponse wraps a send and its stats for the API.
func newSendResponse(s *models.EmailSend, stats SendStats) SendResponse {
	return SendResponse{EmailSend: *s, Stats: stats}
}

// newSendRecipientItem wraps a recipient row for the API, carrying the guest's
// name and party name. The row's Guest relation (and the guest's Party) must
// be loaded; missing relations fall back to empty strings rather than
// panicking.
func newSendRecipientItem(r *models.EmailRecipient) SendRecipientItem {
	item := SendRecipientItem{EmailRecipient: *r}
	if r.Guest != nil {
		item.GuestName = r.Guest.FullName
		if r.Guest.Party != nil {
			item.PartyName = r.Guest.Party.Name
		}
	}
	return item
}
