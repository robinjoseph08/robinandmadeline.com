package parties

import (
	"context"
	"database/sql"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// This file holds the info-collection status transitions (ADR 0005). Each moves
// only the two stored flags (requested / confirmed); the status is always
// derived via the model. Field edits do NOT live here: UpdateParty leaves these
// flags untouched.

// errInfoIncomplete is the 422 returned by the gated transitions when a party is
// missing fields required to be complete.
func errInfoIncomplete() error {
	return errcodes.ValidationError("Required fields are missing, so the party cannot be marked complete.")
}

// RequestInfo marks the info link as sent (requested=true, confirmed=false),
// resetting an already-complete party back to waiting until the guest submits or
// the admin marks it complete. It is idempotent and ungated.
func (s *Service) RequestInfo(ctx context.Context, id string) (*models.Party, error) {
	return s.setCollectionFlags(ctx, id, true, false)
}

// MarkComplete is the admin "this party's info is done" action. It is gated on
// required fields (422 if missing), then sets confirmed=true and requested=true.
func (s *Service) MarkComplete(ctx context.Context, id string) (*models.Party, error) {
	return s.confirmComplete(ctx, id)
}

// MarkIncomplete is the admin "re-open this party" action (requested=true,
// confirmed=false). It is ungated; re-opening is always allowed.
func (s *Service) MarkIncomplete(ctx context.Context, id string) (*models.Party, error) {
	return s.setCollectionFlags(ctx, id, true, false)
}

// confirmComplete is the gated transition behind MarkComplete: it checks
// RequiredFieldsPresent (422 if missing) and writes requested=confirmed=true.
// Load, gate, and write run in one transaction with the party row locked, so a
// concurrent party edit (say, clearing the address the gate just approved)
// cannot slip between the gate and the flag write and confirm a party whose
// required fields are missing (ADR 0005). FOR UPDATE cannot ride on the guests
// join, so the party row is locked by a slim select first and the guests the
// gate needs are loaded separately inside the transaction. The guest-facing
// counterpart (the info form submit, #8) lives in pkg/info, which inlines this
// same gated transition inside its form-write transaction so a rejected submit
// rolls the form's writes back too.
func (s *Service) confirmComplete(ctx context.Context, id string) (*models.Party, error) {
	party := new(models.Party)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		err := tx.NewSelect().Model(party).Where("p.id = ?", id).For("UPDATE").Scan(ctx)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errcodes.NotFound("party")
			}
			return errors.Wrap(err, "load party")
		}
		// The guests ride the response too, so load them in the same creation
		// order every other party load uses.
		guestsQuery := orderGuestsByCreation(tx.NewSelect().Model(&party.Guests).Where("g.party_id = ?", id))
		if err := guestsQuery.Scan(ctx); err != nil {
			return errors.Wrap(err, "load guests")
		}

		if !party.RequiredFieldsPresent() {
			return errInfoIncomplete()
		}
		_, err = applyCollectionFlags(ctx, tx, party, true, true)
		return err
	})
	if err != nil {
		return nil, err
	}
	return party, nil
}

// setCollectionFlags loads the party then writes the given flags. It is the
// ungated path used by RequestInfo / MarkIncomplete, so unlike confirmComplete
// it needs no gate (and therefore no lock: the written values do not depend on
// what was read).
func (s *Service) setCollectionFlags(ctx context.Context, id string, requested, confirmed bool) (*models.Party, error) {
	party, err := loadPartyWithGuests(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	return applyCollectionFlags(ctx, s.db, party, requested, confirmed)
}

// applyCollectionFlags persists the two collection flags (and updated_at) for a
// loaded party, updating only those columns. It takes a bun.IDB so it runs on
// the pool (the ungated path) or inside confirmComplete's transaction.
func applyCollectionFlags(ctx context.Context, db bun.IDB, party *models.Party, requested, confirmed bool) (*models.Party, error) {
	party.InfoCollectionRequested = requested
	party.InfoCollectionConfirmed = confirmed
	party.UpdatedAt = time.Now()

	_, err := db.NewUpdate().Model(party).
		Column("info_collection_requested", "info_collection_confirmed", "updated_at").
		WherePK().Exec(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "update collection flags")
	}
	return party, nil
}
