package parties

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/uptrace/bun"
)

// CreateGuestInput is the data to add a guest to a party. The party is supplied
// separately (the create route is nested under the party), so PartyID is not a
// field here. is_primary may be requested at creation; when true the service
// demotes any existing primary in the same transaction.
type CreateGuestInput struct {
	FullName            string
	Email               *string
	Phone               *string
	Roles               []string
	IsPrimary           bool
	IsChild             bool
	IsDrinking          bool
	IsPlaceholder       bool
	DietaryRestrictions *string
	TableNumber         *int
	SeatNumber          *int
}

// UpdateGuestInput is the full desired state of a guest's editable fields
// (PUT-style). Setting IsPrimary=true promotes this guest and demotes the
// party's previous primary transactionally.
type UpdateGuestInput struct {
	FullName            string
	Email               *string
	Phone               *string
	Roles               []string
	IsPrimary           bool
	IsChild             bool
	IsDrinking          bool
	IsPlaceholder       bool
	DietaryRestrictions *string
	TableNumber         *int
	SeatNumber          *int
}

// CreateGuest adds a guest to an existing party. If the party does not exist it
// returns ErrNotFound. When IsPrimary is requested, the previous primary (if
// any) is demoted in the same transaction so a party never has two primaries.
func (s *Service) CreateGuest(ctx context.Context, partyID string, in CreateGuestInput) (*Guest, error) {
	if strings.TrimSpace(in.FullName) == "" {
		return nil, validationErr("full_name is required")
	}

	now := time.Now()
	guest := &Guest{
		ID:                  newID(),
		PartyID:             partyID,
		FullName:            strings.TrimSpace(in.FullName),
		Email:               trimmedOrNil(in.Email),
		Phone:               trimmedOrNil(in.Phone),
		Roles:               normalizeStringSlice(in.Roles),
		IsPrimary:           in.IsPrimary,
		IsChild:             in.IsChild,
		IsDrinking:          in.IsDrinking,
		IsPlaceholder:       in.IsPlaceholder,
		DietaryRestrictions: trimmedOrNil(in.DietaryRestrictions),
		TableNumber:         in.TableNumber,
		SeatNumber:          in.SeatNumber,
		CreatedAt:           now,
		UpdatedAt:           now,
	}

	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		// Confirm the party exists so we return ErrNotFound rather than a raw FK
		// violation, and so a primary demotion targets a real party.
		exists, err := tx.NewSelect().Model((*Party)(nil)).Where("id = ?", partyID).Exists(ctx)
		if err != nil {
			return fmt.Errorf("check party exists: %w", err)
		}
		if !exists {
			return ErrNotFound
		}

		if guest.IsPrimary {
			if err := demoteCurrentPrimary(ctx, tx, partyID, ""); err != nil {
				return err
			}
		}

		if _, err := tx.NewInsert().Model(guest).Exec(ctx); err != nil {
			return fmt.Errorf("insert guest: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return guest, nil
}

// GetGuest loads a single guest, or ErrNotFound.
func (s *Service) GetGuest(ctx context.Context, id string) (*Guest, error) {
	guest := new(Guest)
	err := s.db.NewSelect().Model(guest).Where("g.id = ?", id).Scan(ctx)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("load guest: %w", err)
	}
	return guest, nil
}

// UpdateGuest applies the editable fields to a guest. Promoting it to primary
// (IsPrimary=true) demotes the party's previous primary in the same
// transaction, preserving the single-primary invariant.
func (s *Service) UpdateGuest(ctx context.Context, id string, in UpdateGuestInput) (*Guest, error) {
	if strings.TrimSpace(in.FullName) == "" {
		return nil, validationErr("full_name is required")
	}

	guest := new(Guest)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		// Load inside the tx so the party_id used for demotion is consistent.
		if err := tx.NewSelect().Model(guest).Where("g.id = ?", id).Scan(ctx); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrNotFound
			}
			return fmt.Errorf("load guest: %w", err)
		}

		// Demote the previous primary (excluding this guest) before promoting
		// this one, so at most one primary remains.
		if in.IsPrimary {
			if err := demoteCurrentPrimary(ctx, tx, guest.PartyID, guest.ID); err != nil {
				return err
			}
		}

		guest.FullName = strings.TrimSpace(in.FullName)
		guest.Email = trimmedOrNil(in.Email)
		guest.Phone = trimmedOrNil(in.Phone)
		guest.Roles = normalizeStringSlice(in.Roles)
		guest.IsPrimary = in.IsPrimary
		guest.IsChild = in.IsChild
		guest.IsDrinking = in.IsDrinking
		guest.IsPlaceholder = in.IsPlaceholder
		guest.DietaryRestrictions = trimmedOrNil(in.DietaryRestrictions)
		guest.TableNumber = in.TableNumber
		guest.SeatNumber = in.SeatNumber
		guest.UpdatedAt = time.Now()

		_, err := tx.NewUpdate().Model(guest).
			Column("full_name", "email", "phone", "roles", "is_primary",
				"is_child", "is_drinking", "is_placeholder", "dietary_restrictions",
				"table_number", "seat_number", "updated_at").
			WherePK().Exec(ctx)
		if err != nil {
			return fmt.Errorf("update guest: %w", err)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return guest, nil
}

// DeleteGuest removes a guest. Deleting the party's primary simply leaves the
// party without one, which the status derivation reports as incomplete (no
// primary email). Deleting a non-existent guest returns ErrNotFound.
func (s *Service) DeleteGuest(ctx context.Context, id string) error {
	res, err := s.db.NewDelete().Model((*Guest)(nil)).Where("id = ?", id).Exec(ctx)
	if err != nil {
		return fmt.Errorf("delete guest: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("delete guest rows affected: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// demoteCurrentPrimary clears is_primary on the party's current primary guest,
// excluding excludeID (the guest about to become primary, if it already exists).
// Run inside the same transaction as the promotion so the swap is atomic and the
// partial unique index ux_guests_one_primary_per_party is never transiently
// violated.
func demoteCurrentPrimary(ctx context.Context, tx bun.Tx, partyID, excludeID string) error {
	q := tx.NewUpdate().Model((*Guest)(nil)).
		Set("is_primary = FALSE").
		Set("updated_at = ?", time.Now()).
		Where("party_id = ?", partyID).
		Where("is_primary = TRUE")
	if excludeID != "" {
		q = q.Where("id <> ?", excludeID)
	}
	if _, err := q.Exec(ctx); err != nil {
		return fmt.Errorf("demote current primary: %w", err)
	}
	return nil
}
