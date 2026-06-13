package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	up := func(ctx context.Context, db *bun.DB) error {
		// email_templates: reusable subject/body pairs with merge field
		// placeholders ({{guest_name}} etc.), rendered per recipient at send
		// time, never stored resolved.
		_, err := db.ExecContext(ctx, `
			CREATE TABLE email_templates (
				id UUID PRIMARY KEY,
				name TEXT NOT NULL,
				subject TEXT NOT NULL,
				body TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)
		if err != nil {
			return fmt.Errorf("create email_templates table: %w", err)
		}

		// email_sends: one admin-triggered dispatch. subject/body are
		// snapshotted (the admin may edit after loading a template), so
		// template_id is provenance only: nullable for one-offs, and SET NULL
		// on template delete so past sends outlive their template. The filter
		// that selected the recipients is stored as JSONB for the audit trail.
		_, err = db.ExecContext(ctx, `
			CREATE TABLE email_sends (
				id UUID PRIMARY KEY,
				template_id UUID REFERENCES email_templates (id) ON DELETE SET NULL,
				subject TEXT NOT NULL,
				body TEXT NOT NULL,
				recipient_filter JSONB NOT NULL DEFAULT '{}',
				sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				sent_by TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)
		if err != nil {
			return fmt.Errorf("create email_sends table: %w", err)
		}

		// email_recipients: one guest's copy of a send, the queue's unit of
		// work (ADR 0004). status is TEXT guarded by a CHECK constraint,
		// matching event_rsvps.status. email_address is snapshotted at enqueue
		// time. mailgun_message_id is set once Mailgun accepts the message and
		// is how delivery webhooks find the row. updated_at doubles as the
		// claim timestamp for stuck-sending detection on restart. Both FKs
		// cascade: deleting a send removes its recipient rows, and deleting a
		// guest removes their rows from past sends.
		_, err = db.ExecContext(ctx, `
			CREATE TABLE email_recipients (
				id UUID PRIMARY KEY,
				send_id UUID NOT NULL REFERENCES email_sends (id) ON DELETE CASCADE,
				guest_id UUID NOT NULL REFERENCES guests (id) ON DELETE CASCADE,
				email_address TEXT NOT NULL,
				mailgun_message_id TEXT,
				status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed')),
				failure_reason TEXT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)
		`)
		if err != nil {
			return fmt.Errorf("create email_recipients table: %w", err)
		}

		// The send detail page and the per-send stats aggregate by send.
		_, err = db.ExecContext(ctx, `CREATE INDEX ix_email_recipients_send_id ON email_recipients (send_id)`)
		if err != nil {
			return fmt.Errorf("create email_recipients send_id index: %w", err)
		}

		// The worker picks up queued rows and the reconciler scans sending
		// rows; both look up by status.
		_, err = db.ExecContext(ctx, `CREATE INDEX ix_email_recipients_status ON email_recipients (status)`)
		if err != nil {
			return fmt.Errorf("create email_recipients status index: %w", err)
		}

		// Delivery webhooks match rows by Mailgun message id. Partial: only
		// rows that have been accepted by Mailgun carry one.
		_, err = db.ExecContext(ctx, `CREATE INDEX ix_email_recipients_mailgun_message_id ON email_recipients (mailgun_message_id) WHERE mailgun_message_id IS NOT NULL`)
		if err != nil {
			return fmt.Errorf("create email_recipients mailgun_message_id index: %w", err)
		}

		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		// email_recipients first (references email_sends), then email_sends
		// (references email_templates), then email_templates.
		for _, table := range []string{"email_recipients", "email_sends", "email_templates"} {
			if _, err := db.ExecContext(ctx, "DROP TABLE IF EXISTS "+table); err != nil {
				return fmt.Errorf("drop %s table: %w", table, err)
			}
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
