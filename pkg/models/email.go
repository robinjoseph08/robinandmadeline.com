package models

import (
	"time"

	"github.com/uptrace/bun"
)

// Email recipient delivery status values, stored as TEXT guarded by a CHECK
// constraint (like event_rsvps.status). A recipient row is born queued; the
// background worker claims it as sending, then records sent or failed; the
// Mailgun webhook later upgrades sent rows to delivered, bounced, or failed
// (ADR 0004). The //tygo:emit line generates the matching TypeScript union.
const (
	//tygo:emit export type EmailRecipientStatus = typeof EmailQueued | typeof EmailSending | typeof EmailSent | typeof EmailDelivered | typeof EmailBounced | typeof EmailFailed;
	EmailQueued    = "queued"
	EmailSending   = "sending"
	EmailSent      = "sent"
	EmailDelivered = "delivered"
	EmailBounced   = "bounced"
	EmailFailed    = "failed"
)

// EmailTemplate is a reusable email the couple composes once and sends many
// times. subject and body may contain merge field placeholders (for example
// {{guest_name}}), which are rendered per recipient at send time by the
// worker, never stored resolved.
type EmailTemplate struct {
	bun.BaseModel `bun:"table:email_templates,alias:et" tstype:"-"`

	ID      string `bun:"id,pk" json:"id"`
	Name    string `bun:"name" json:"name"`
	Subject string `bun:"subject" json:"subject"`
	Body    string `bun:"body" json:"body"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`
}

// RecipientFilter is the criteria a send targets, stored as JSONB on the send
// for the audit trail. Every field is optional; absent fields don't constrain.
// The semantics mirror the flat guest list filters: side/relation/circle/
// invitation_type constrain through the guest's party, tags matches guests
// whose tags array overlaps the selected tags (the guest has ANY of them),
// event/rsvp_status constrain through the guest's Event RSVP rows (a row is the
// invitation, ADR 0002), and info_collection_status filters on the party's
// derived status (ADR 0005).
//
// It lives in pkg/models rather than pkg/emails because EmailSend stores it
// (feature packages import models, never the reverse). The validate tags are
// exercised when the filter arrives nested inside an emails payload.
type RecipientFilter struct {
	Side     *string `json:"side,omitempty" validate:"omitempty,oneof=robin madeline" tstype:"Side"`
	Relation *string `json:"relation,omitempty" validate:"omitempty,oneof=family friend" tstype:"Relation"`
	Circle   *string `json:"circle,omitempty" validate:"omitempty,oneof=Immediate Extended College Work Childhood Other" tstype:"Circle"`
	// Tags is intentionally unvalidated: tags are an open set, so any value is
	// a legal filter that simply may match nothing. Multiple tags are OR'd (a
	// guest matches when it carries any of them); an empty/absent slice does
	// not constrain. Stored as JSONB, so the slice shape needs no migration.
	Tags                 []string `json:"tags,omitempty"`
	EventID              *string  `json:"event_id,omitempty" validate:"omitempty,uuid"`
	RSVPStatus           *string  `json:"rsvp_status,omitempty" validate:"omitempty,oneof=pending attending not_attending" tstype:"EventRSVPStatus"`
	InvitationType       *string  `json:"invitation_type,omitempty" validate:"omitempty,oneof=physical digital" tstype:"InvitationType"`
	InfoCollectionStatus *string  `json:"info_collection_status,omitempty" validate:"omitempty,oneof=complete incomplete" tstype:"InfoCollectionStatus"`
}

// EmailSend is one admin-triggered dispatch: the subject/body as sent (the
// admin may have edited them after loading a template, so they are snapshotted
// here, not referenced), the filter that selected the recipients, and who
// triggered it. template_id records provenance only and is NULL for one-offs;
// deleting a template keeps past sends intact (FK SET NULL).
type EmailSend struct {
	bun.BaseModel `bun:"table:email_sends,alias:es" tstype:"-"`

	ID              string          `bun:"id,pk" json:"id"`
	TemplateID      *string         `bun:"template_id" json:"template_id"`
	Subject         string          `bun:"subject" json:"subject"`
	Body            string          `bun:"body" json:"body"`
	RecipientFilter RecipientFilter `bun:"recipient_filter,type:jsonb" json:"recipient_filter"`
	SentAt          time.Time       `bun:"sent_at,nullzero" json:"sent_at"`
	SentBy          string          `bun:"sent_by" json:"sent_by"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`
}

// EmailRecipient is one guest's copy of a send, the unit the queue works in
// (ADR 0004): queued rows are claimed in batches (status sending), sent via
// Mailgun (sent + mailgun_message_id), and upgraded by the delivery webhook.
//
// email_address is snapshotted at enqueue time so the send goes to the address
// the admin previewed even if the guest's email changes before the worker runs.
// mailgun_message_id is stored without angle brackets (the form webhooks use).
// failure_reason carries the human-readable cause for failed/bounced rows.
// updated_at doubles as the claim timestamp for stuck-sending detection.
type EmailRecipient struct {
	bun.BaseModel `bun:"table:email_recipients,alias:erc" tstype:"-"`

	ID               string  `bun:"id,pk" json:"id"`
	SendID           string  `bun:"send_id" json:"send_id"`
	GuestID          string  `bun:"guest_id" json:"guest_id"`
	EmailAddress     string  `bun:"email_address" json:"email_address"`
	MailgunMessageID *string `bun:"mailgun_message_id" json:"mailgun_message_id"`
	Status           string  `bun:"status" json:"status" tstype:"EmailRecipientStatus"`
	FailureReason    *string `bun:"failure_reason" json:"failure_reason"`
	// AttemptedAt is when the worker last claimed the row for a dispatch
	// attempt; counting rows attempted since UTC midnight is the daily send
	// budget (Mailgun's free-plan quota). NULL until the first attempt; a
	// requeued row keeps its last attempt time until the next claim overwrites
	// it.
	AttemptedAt *time.Time `bun:"attempted_at" json:"attempted_at"`
	// QuotaRequeues counts how many times a quota-classified Mailgun
	// rejection has requeued this row. The worker fails the row once the
	// count reaches its cap, bounding the retry loop a rejection misread as
	// quota would otherwise spin in forever. Worker bookkeeping, omitted from
	// the API surface.
	QuotaRequeues int `bun:"quota_requeues" json:"-" tstype:"-"`

	CreatedAt time.Time `bun:"created_at,nullzero" json:"created_at"`
	UpdatedAt time.Time `bun:"updated_at,nullzero" json:"updated_at"`

	// Guest is populated only when explicitly loaded (the worker loads it, with
	// its Party, to render merge fields; the send detail loads it for display).
	// Omitted from JSON: responses surface guest context through the emails
	// package's response types.
	Guest *Guest `bun:"rel:belongs-to,join:guest_id=id" json:"-" tstype:"-"`
}
