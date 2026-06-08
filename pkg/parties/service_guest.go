package parties

import (
	"context"
	"database/sql"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// CreateGuest adds a guest to an existing party (404 if the party is missing).
// When IsPrimary is requested, the previous primary (if any) is demoted in the
// same transaction so a party never has two primaries. The payload is already
// bound, trimmed, defaulted, and validated by the binder, so the fields are
// assigned directly; tags arrives as a non-nil slice (defaulted to []) so it
// stores '{}', not NULL.
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
		IsPlaceholder:       in.IsPlaceholder,
		DietaryRestrictions: in.DietaryRestrictions,
		TableNumber:         in.TableNumber,
		SeatNumber:          in.SeatNumber,
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

		if _, err := tx.NewInsert().Model(guest).Exec(ctx); err != nil {
			return errors.Wrap(err, "insert guest")
		}
		return nil
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
		guest.IsPlaceholder = in.IsPlaceholder
		guest.DietaryRestrictions = in.DietaryRestrictions
		guest.TableNumber = in.TableNumber
		guest.SeatNumber = in.SeatNumber
		guest.UpdatedAt = time.Now()

		_, err := tx.NewUpdate().Model(guest).
			Column("full_name", "email", "phone", "tags", "is_primary",
				"is_child", "is_drinking", "is_placeholder", "dietary_restrictions",
				"table_number", "seat_number", "updated_at").
			WherePK().Exec(ctx)
		if err != nil {
			return errors.Wrap(err, "update guest")
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
// transaction, preserving the single-primary invariant. A provided nullable text
// field is stored as SQL NULL when blank. A missing guest returns a 404. With no
// fields provided it is a no-op returning the current guest.
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
		originalPartyID := guest.PartyID

		cols := make([]string, 0, 12)
		if in.PartyID != nil && *in.PartyID != guest.PartyID {
			// Moving the guest to another party: confirm the target exists so we
			// return a clear error rather than a raw FK violation.
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
		if in.IsPrimary != nil {
			guest.IsPrimary = *in.IsPrimary
			cols = append(cols, "is_primary")
		}
		if in.IsChild != nil {
			guest.IsChild = *in.IsChild
			cols = append(cols, "is_child")
		}
		if in.IsDrinking != nil {
			guest.IsDrinking = *in.IsDrinking
			cols = append(cols, "is_drinking")
		}
		if in.IsPlaceholder != nil {
			guest.IsPlaceholder = *in.IsPlaceholder
			cols = append(cols, "is_placeholder")
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

		// Nothing to change: leave the loaded guest as-is.
		if len(cols) == 0 {
			return nil
		}

		// Keep the single-primary invariant in the guest's final party. Demote any
		// other primary there (excluding this guest) when the guest will be primary
		// and either it is being promoted now or it is a primary guest moving into a
		// new party (which would otherwise collide on the partial unique index).
		movedParty := guest.PartyID != originalPartyID
		if guest.IsPrimary && ((in.IsPrimary != nil && *in.IsPrimary) || movedParty) {
			if err := demoteCurrentPrimary(ctx, tx, guest.PartyID, guest.ID); err != nil {
				return err
			}
		}

		guest.UpdatedAt = time.Now()
		cols = append(cols, "updated_at")

		_, err := tx.NewUpdate().Model(guest).Column(cols...).WherePK().Exec(ctx)
		if err != nil {
			return errors.Wrap(err, "patch guest")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return guest, nil
}

// DeleteGuest removes a guest. Deleting the party's primary simply leaves the
// party without one (status then derives incomplete). A missing guest returns a
// 404.
func (s *Service) DeleteGuest(ctx context.Context, id string) error {
	res, err := s.db.NewDelete().Model((*models.Guest)(nil)).Where("id = ?", id).Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "delete guest")
	}
	n, err := res.RowsAffected()
	if err != nil {
		return errors.Wrap(err, "delete guest rows affected")
	}
	if n == 0 {
		return errcodes.NotFound("guest")
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
