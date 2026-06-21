package parties

import (
	"context"
	"database/sql"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/events"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// CreateGuest adds a guest to an existing party (404 if the party is missing).
// When IsPrimary is requested, the previous primary (if any) is demoted in the
// same transaction so a party never has two primaries. The new guest is born
// invited (a pending Event RSVP) to every public event, in the same
// transaction (ADR 0002). The payload is already bound, trimmed, defaulted,
// and validated by the binder, so the fields are assigned directly; tags
// arrives as a non-nil slice (defaulted to []) so it stores '{}', not NULL.
func (s *Service) CreateGuest(ctx context.Context, partyID string, in CreateGuestPayload) (*models.Guest, error) {
	now := time.Now()
	guest := &models.Guest{
		ID:                  newID(),
		PartyID:             partyID,
		FullName:            in.FullName,
		Email:               in.Email,
		Phone:               in.Phone,
		Tags:                in.Tags,
		IsPrimary:           in.IsPrimary,
		IsChild:             in.IsChild,
		IsDrinking:          in.IsDrinking,
		PlaceholderText:     in.PlaceholderText,
		DietaryRestrictions: in.DietaryRestrictions,
		TableNumber:         in.TableNumber,
		SeatNumber:          in.SeatNumber,
		Subscribed:          true, // a new guest is born subscribed (ADR 0009)
		CreatedAt:           now,
		UpdatedAt:           now,
	}

	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		// Confirm the party exists so we return a 404 rather than a raw FK
		// violation, and so a primary demotion targets a real party.
		exists, err := tx.NewSelect().Model((*models.Party)(nil)).Where("id = ?", partyID).Exists(ctx)
		if err != nil {
			return errors.Wrap(err, "check party exists")
		}
		if !exists {
			return errcodes.NotFound("party")
		}

		if guest.IsPrimary {
			if err := demoteCurrentPrimary(ctx, tx, partyID, ""); err != nil {
				return err
			}
		}

		// A concurrent promotion can commit between the demotion above and this
		// insert, so the one-primary-per-party index can still fire; surface that
		// as a 409 rather than a raw unique violation.
		if _, err := tx.NewInsert().Model(guest).Exec(ctx); err != nil {
			return errcodes.ConflictOnConstraint(errors.Wrap(err, "insert guest"),
				"ux_guests_one_primary_per_party", "Another guest became this party's primary at the same time; try again.")
		}

		// A new guest is born invited to every public event (ADR 0002): the
		// backfill shares this transaction so the guest and their pending Event
		// RSVPs appear atomically.
		return events.BackfillPublicEventRSVPs(ctx, tx, guest.ID)
	})
	if err != nil {
		return nil, err
	}
	return guest, nil
}

// GetGuest loads a single guest, or a 404.
func (s *Service) GetGuest(ctx context.Context, id string) (*models.Guest, error) {
	guest := new(models.Guest)
	err := s.db.NewSelect().Model(guest).Where("g.id = ?", id).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("guest")
		}
		return nil, errors.Wrap(err, "load guest")
	}
	return guest, nil
}

// UpdateGuest applies the editable fields to a guest. Promoting it to primary
// demotes the party's previous primary in the same transaction, preserving the
// single-primary invariant.
func (s *Service) UpdateGuest(ctx context.Context, id string, in UpdateGuestPayload) (*models.Guest, error) {
	guest := new(models.Guest)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		// Load inside the tx so the party_id used for demotion is consistent.
		if err := tx.NewSelect().Model(guest).Where("g.id = ?", id).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errcodes.NotFound("guest")
			}
			return errors.Wrap(err, "load guest")
		}

		// A party must keep exactly one primary, so a full-state edit cannot clear
		// the flag on the current primary any more than the grid can (its primary
		// cell is locked, and PatchGuest refuses the same in-place unset). Promote
		// another guest to move it.
		if guest.IsPrimary && !in.IsPrimary {
			return errcodes.ValidationError("A party must have a primary guest; promote another guest first.")
		}

		// Demote the previous primary (excluding this guest) before promoting this
		// one, so at most one primary remains.
		if in.IsPrimary {
			if err := demoteCurrentPrimary(ctx, tx, guest.PartyID, guest.ID); err != nil {
				return err
			}
		}

		// The payload is already bound, trimmed, defaulted, and validated by the
		// binder, so the fields are assigned directly.
		guest.FullName = in.FullName
		guest.Email = in.Email
		guest.Phone = in.Phone
		guest.Tags = in.Tags
		guest.IsPrimary = in.IsPrimary
		guest.IsChild = in.IsChild
		guest.IsDrinking = in.IsDrinking
		guest.PlaceholderText = in.PlaceholderText
		guest.DietaryRestrictions = in.DietaryRestrictions
		guest.TableNumber = in.TableNumber
		guest.SeatNumber = in.SeatNumber
		guest.UpdatedAt = time.Now()

		// A concurrent promotion can commit between the demotion above and this
		// update, invisible to the demote under read committed, so the
		// one-primary-per-party index can still fire; surface that as a 409
		// rather than a raw unique violation.
		_, err := tx.NewUpdate().Model(guest).
			Column("full_name", "email", "phone", "tags", "is_primary",
				"is_child", "is_drinking", "placeholder_text", "dietary_restrictions",
				"table_number", "seat_number", "updated_at").
			WherePK().Exec(ctx)
		if err != nil {
			return errcodes.ConflictOnConstraint(errors.Wrap(err, "update guest"),
				"ux_guests_one_primary_per_party", "Another guest became this party's primary at the same time; try again.")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return guest, nil
}

// PatchGuest applies a partial update to a guest: only the provided fields (a
// non-nil pointer, or a non-nil tags slice) are written, each as a single
// column, so a spreadsheet cell edit saves just that field. Promoting it to
// primary (is_primary=true) demotes the party's previous primary in the same
// transaction, preserving the single-primary invariant; unsetting the only
// primary in place is refused (promote another guest instead). Moving the guest
// to another party (party_id) lands it there as a non-primary, leaving the
// destination's primary intact, and mends the source party: if the mover was its
// last guest the source is deleted, and if the mover was its primary the source's
// oldest remaining guest is promoted. A provided nullable text field is stored as
// SQL NULL when blank. A missing guest returns a 404. With no fields provided it
// is a no-op returning the current guest.
func (s *Service) PatchGuest(ctx context.Context, id string, in PatchGuestPayload) (*models.Guest, error) {
	guest := new(models.Guest)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		// Load inside the tx so the party_id used for demotion is consistent.
		if err := tx.NewSelect().Model(guest).Where("g.id = ?", id).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errcodes.NotFound("guest")
			}
			return errors.Wrap(err, "load guest")
		}
		wasPrimary := guest.IsPrimary
		originalPartyID := guest.PartyID
		moving := in.PartyID != nil && *in.PartyID != originalPartyID

		// Refuse to strip a party of its only primary in place: promote another
		// guest instead of leaving the party with none. A move is exempt because it
		// re-primaries the source below.
		if !moving && in.IsPrimary != nil && !*in.IsPrimary && wasPrimary {
			return errcodes.ValidationError("A party must have a primary guest; promote another guest first.")
		}

		cols := make([]string, 0, 12)
		if moving {
			// Lock the source party row before any guest write so the source mend
			// below (delete-if-empty, re-primary) serializes per party and cannot
			// strand an empty party; see lockParty.
			if err := lockParty(ctx, tx, originalPartyID); err != nil {
				return err
			}
			// Confirm the target exists so we return a clear error rather than a raw
			// FK violation.
			exists, err := tx.NewSelect().Model((*models.Party)(nil)).Where("id = ?", *in.PartyID).Exists(ctx)
			if err != nil {
				return errors.Wrap(err, "check target party exists")
			}
			if !exists {
				return errcodes.ValidationError("That party does not exist.")
			}
			guest.PartyID = *in.PartyID
			cols = append(cols, "party_id")
		}
		if in.FullName != nil {
			guest.FullName = *in.FullName
			cols = append(cols, "full_name")
		}
		if in.Email != nil {
			guest.Email = pointerutil.EmptyString(*in.Email)
			cols = append(cols, "email")
		}
		if in.Phone != nil {
			guest.Phone = pointerutil.EmptyString(*in.Phone)
			cols = append(cols, "phone")
		}
		if in.Tags != nil {
			guest.Tags = in.Tags
			cols = append(cols, "tags")
		}
		if in.IsChild != nil {
			guest.IsChild = *in.IsChild
			cols = append(cols, "is_child")
		}
		if in.IsDrinking != nil {
			guest.IsDrinking = *in.IsDrinking
			cols = append(cols, "is_drinking")
		}
		if in.PlaceholderText != nil {
			// A provided blank is the "clear this cell" gesture: NULL turns the
			// row back into a regular guest.
			guest.PlaceholderText = pointerutil.EmptyString(*in.PlaceholderText)
			cols = append(cols, "placeholder_text")
		}
		if in.DietaryRestrictions != nil {
			guest.DietaryRestrictions = pointerutil.EmptyString(*in.DietaryRestrictions)
			cols = append(cols, "dietary_restrictions")
		}
		if in.TableNumber != nil {
			guest.TableNumber = in.TableNumber
			cols = append(cols, "table_number")
		}
		if in.SeatNumber != nil {
			guest.SeatNumber = in.SeatNumber
			cols = append(cols, "seat_number")
		}

		// Resolve the guest's primary flag in its final party. An explicit value
		// wins; otherwise a moved primary joins the destination as a non-primary so
		// the destination keeps its own (the source is re-primaried below).
		if in.IsPrimary != nil {
			guest.IsPrimary = *in.IsPrimary
			cols = append(cols, "is_primary")
		} else if moving && wasPrimary {
			guest.IsPrimary = false
			cols = append(cols, "is_primary")
		}

		// Nothing to change: leave the loaded guest as-is.
		if len(cols) == 0 {
			return nil
		}

		// When this guest is being promoted to primary, demote any other primary in
		// its final party (excluding itself) so the party keeps exactly one and the
		// partial unique index is never transiently violated.
		if guest.IsPrimary && in.IsPrimary != nil && *in.IsPrimary {
			if err := demoteCurrentPrimary(ctx, tx, guest.PartyID, guest.ID); err != nil {
				return err
			}
		}

		guest.UpdatedAt = time.Now()
		cols = append(cols, "updated_at")

		// Same promote race as UpdateGuest: a concurrent primary committing after
		// the demotion can make this update hit the one-primary-per-party index,
		// which surfaces as a 409 rather than a raw unique violation.
		if _, err := tx.NewUpdate().Model(guest).Column(cols...).WherePK().Exec(ctx); err != nil {
			return errcodes.ConflictOnConstraint(errors.Wrap(err, "patch guest"),
				"ux_guests_one_primary_per_party", "Another guest became this party's primary at the same time; try again.")
		}

		// After a move, mend the source party: delete it if the mover was its last
		// guest, or promote a new primary there if the mover was its primary.
		if moving {
			remaining, err := tx.NewSelect().Model((*models.Guest)(nil)).
				Where("party_id = ?", originalPartyID).Count(ctx)
			if err != nil {
				return errors.Wrap(err, "count source guests")
			}
			if remaining == 0 {
				if _, err := tx.NewDelete().Model((*models.Party)(nil)).Where("id = ?", originalPartyID).Exec(ctx); err != nil {
					return errors.Wrap(err, "delete emptied source party")
				}
			} else if wasPrimary {
				if err := promoteOldestGuest(ctx, tx, originalPartyID); err != nil {
					return err
				}
			}
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return guest, nil
}

// DeleteGuest removes a guest, keeping the party invariants intact. A party
// never outlives its last guest: deleting it deletes the party too. Otherwise,
// if the deleted guest was the primary, the oldest remaining guest is promoted
// so every non-empty party keeps exactly one primary. A missing guest returns a
// 404. All of this runs in one transaction, with the party row locked before
// the guest write so concurrent removals from the same party serialize (two
// deletes of the last two guests would otherwise each see one guest remaining
// and neither would delete the party); an observer never sees a party with no
// primary, an empty party that is about to be deleted, or a stranded empty one.
func (s *Service) DeleteGuest(ctx context.Context, id string) error {
	return s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		guest := new(models.Guest)
		if err := tx.NewSelect().Model(guest).Where("g.id = ?", id).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errcodes.NotFound("guest")
			}
			return errors.Wrap(err, "load guest")
		}

		// Serialize the mend below per party; see lockParty.
		if err := lockParty(ctx, tx, guest.PartyID); err != nil {
			return err
		}

		if _, err := tx.NewDelete().Model((*models.Guest)(nil)).Where("id = ?", id).Exec(ctx); err != nil {
			return errors.Wrap(err, "delete guest")
		}

		remaining, err := tx.NewSelect().Model((*models.Guest)(nil)).
			Where("party_id = ?", guest.PartyID).Count(ctx)
		if err != nil {
			return errors.Wrap(err, "count remaining guests")
		}
		if remaining == 0 {
			// The last guest is gone, so the party goes with it.
			if _, err := tx.NewDelete().Model((*models.Party)(nil)).Where("id = ?", guest.PartyID).Exec(ctx); err != nil {
				return errors.Wrap(err, "delete emptied party")
			}
			return nil
		}
		if guest.IsPrimary {
			return promoteOldestGuest(ctx, tx, guest.PartyID)
		}
		return nil
	})
}

// promoteOldestGuest makes a party's oldest remaining guest its primary, used
// after the previous primary leaves the party (deleted, or moved away). It is a
// no-op when the party already has a primary (so a non-primary departure does
// not disturb the existing one) or has no guests at all. Run inside the caller's
// transaction so the single-primary invariant is restored atomically.
func promoteOldestGuest(ctx context.Context, tx bun.Tx, partyID string) error {
	hasPrimary, err := tx.NewSelect().Model((*models.Guest)(nil)).
		Where("party_id = ?", partyID).Where("is_primary = TRUE").Exists(ctx)
	if err != nil {
		return errors.Wrap(err, "check existing primary")
	}
	if hasPrimary {
		return nil
	}

	oldest := new(models.Guest)
	err = tx.NewSelect().Model(oldest).
		Where("g.party_id = ?", partyID).
		Order("g.created_at ASC", "g.id ASC").
		Limit(1).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil // no guests left to promote
		}
		return errors.Wrap(err, "find oldest guest")
	}

	_, err = tx.NewUpdate().Model((*models.Guest)(nil)).
		Set("is_primary = TRUE").
		Set("updated_at = ?", time.Now()).
		Where("id = ?", oldest.ID).Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "promote oldest guest")
	}
	return nil
}

// lockParty takes the party's row lock (a slim SELECT ... FOR UPDATE, the same
// shape confirmComplete uses) inside tx. Transactions that remove a guest from
// a party take it first, before any guest write, so the post-removal mend
// (delete-if-empty, re-primary) serializes per party: without it, two
// transactions each removing one of a party's last two guests would both count
// remaining=1 under read committed and neither would delete the party,
// stranding it empty. The consistent order (party row first, then guest rows)
// keeps the menders from deadlocking each other.
func lockParty(ctx context.Context, tx bun.Tx, partyID string) error {
	var id string
	err := tx.NewSelect().Model((*models.Party)(nil)).Column("id").
		Where("p.id = ?", partyID).For("UPDATE").Scan(ctx, &id)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			// The party vanished between the guest load and the lock (a concurrent
			// party delete cascaded over its guests).
			return errcodes.NotFound("party")
		}
		return errors.Wrap(err, "lock party")
	}
	return nil
}

// demoteCurrentPrimary clears is_primary on the party's current primary,
// excluding excludeID (the guest about to become primary, if it already exists).
// Run inside the promotion's transaction so the swap is atomic and the partial
// unique index ux_guests_one_primary_per_party is never transiently violated.
func demoteCurrentPrimary(ctx context.Context, tx bun.Tx, partyID, excludeID string) error {
	q := tx.NewUpdate().Model((*models.Guest)(nil)).
		Set("is_primary = FALSE").
		Set("updated_at = ?", time.Now()).
		Where("party_id = ?", partyID).
		Where("is_primary = TRUE")
	if excludeID != "" {
		q = q.Where("id <> ?", excludeID)
	}
	if _, err := q.Exec(ctx); err != nil {
		return errors.Wrap(err, "demote current primary")
	}
	return nil
}
