package parties

import (
	"context"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
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
	party, err := loadPartyWithGuests(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if !party.RequiredFieldsPresent() {
		return nil, errInfoIncomplete()
	}
	return s.applyCollectionFlags(ctx, party, true, true)
}

// MarkIncomplete is the admin "re-open this party" action (requested=true,
// confirmed=false). It is ungated; re-opening is always allowed.
func (s *Service) MarkIncomplete(ctx context.Context, id string) (*models.Party, error) {
	return s.setCollectionFlags(ctx, id, true, false)
}

// SubmitInfoForm records a guest's submission of the info form. It is the method
// behind the guest-facing endpoint built later (#8); like MarkComplete it is
// gated on required fields, since the form must collect exactly those.
func (s *Service) SubmitInfoForm(ctx context.Context, id string) (*models.Party, error) {
	party, err := loadPartyWithGuests(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if !party.RequiredFieldsPresent() {
		return nil, errInfoIncomplete()
	}
	return s.applyCollectionFlags(ctx, party, true, true)
}

// setCollectionFlags loads the party then writes the given flags. It is the
// ungated path used by RequestInfo / MarkIncomplete.
func (s *Service) setCollectionFlags(ctx context.Context, id string, requested, confirmed bool) (*models.Party, error) {
	party, err := loadPartyWithGuests(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	return s.applyCollectionFlags(ctx, party, requested, confirmed)
}

// applyCollectionFlags persists the two collection flags (and updated_at) for a
// loaded party, updating only those columns.
func (s *Service) applyCollectionFlags(ctx context.Context, party *models.Party, requested, confirmed bool) (*models.Party, error) {
	party.InfoCollectionRequested = requested
	party.InfoCollectionConfirmed = confirmed
	party.UpdatedAt = time.Now()

	_, err := s.db.NewUpdate().Model(party).
		Column("info_collection_requested", "info_collection_confirmed", "updated_at").
		WherePK().Exec(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "update collection flags")
	}
	return party, nil
}
