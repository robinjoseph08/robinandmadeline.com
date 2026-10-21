package migrations

import (
	"context"
	"fmt"

	"github.com/uptrace/bun"
)

func init() {
	// Every recipient filter criterion became a list (OR within a criterion), so
	// each stored single-value key moves to its plural key as a one-element
	// array. The send detail and idempotent replay read the stored filter back,
	// so old sends must take the new shape rather than fail to unmarshal.
	renames := [][2]string{
		{"side", "sides"},
		{"relation", "relations"},
		{"circle", "circles"},
		{"event_id", "event_ids"},
		{"rsvp_status", "rsvp_statuses"},
		{"invitation_type", "invitation_types"},
		{"info_collection_status", "info_collection_statuses"},
	}

	up := func(ctx context.Context, db *bun.DB) error {
		for _, r := range renames {
			_, err := db.ExecContext(ctx, `
				UPDATE email_sends
				SET recipient_filter = (recipient_filter - ?0) || jsonb_build_object(?1, jsonb_build_array(recipient_filter -> ?0))
				WHERE jsonb_typeof(recipient_filter -> ?0) IS DISTINCT FROM 'null'
				AND recipient_filter -> ?0 IS NOT NULL`, r[0], r[1])
			if err != nil {
				return fmt.Errorf("convert recipient filter %s to %s: %w", r[0], r[1], err)
			}
		}
		return nil
	}

	down := func(ctx context.Context, db *bun.DB) error {
		// A list keeps only its first value: the old shape cannot hold more.
		for _, r := range renames {
			_, err := db.ExecContext(ctx, `
				UPDATE email_sends
				SET recipient_filter = (recipient_filter - ?1) || jsonb_build_object(?0, recipient_filter -> ?1 -> 0)
				WHERE jsonb_array_length(COALESCE(recipient_filter -> ?1, '[]'::jsonb)) > 0`, r[0], r[1])
			if err != nil {
				return fmt.Errorf("convert recipient filter %s to %s: %w", r[1], r[0], err)
			}
		}
		_, err := db.ExecContext(ctx, `UPDATE email_sends SET recipient_filter = recipient_filter - 'guest_ids'`)
		if err != nil {
			return fmt.Errorf("drop recipient filter guest_ids: %w", err)
		}
		return nil
	}

	Migrations.MustRegister(up, down)
}
