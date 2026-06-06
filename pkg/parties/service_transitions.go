package parties

import (
	"context"
	"fmt"
	"time"
)

// This file holds the info-collection status transitions (ADR 0005). Each one
// moves only the two stored flags (requested / confirmed); the status itself is
// always derived via the status.go functions. Field edits do NOT live here:
// UpdateParty deliberately leaves these flags untouched.

// RequestInfo marks that the party's info link has been sent, delegating
// collection to the guest. This is also what the UI's "copy info link" action
// fires. It sets requested=true and confirmed=false, which resets an
// already-complete party back to "waiting" (incomplete) until the guest submits
// or the admin marks it complete. It is idempotent and has no required-fields
// gate (you can always (re)send the link).
func (s *Service) RequestInfo(ctx context.Context, id string) (*Party, error) {
	return s.setCollectionFlags(ctx, id, true, false)
}

// MarkComplete is the admin "this party's info is done" action. It is gated:
// the party must have all required fields present, else ErrRequiredFields (422).
// On success it sets confirmed=true and requested=true, so the party reads
// complete and is treated as delegated/affirmed rather than merely data-derived.
func (s *Service) MarkComplete(ctx context.Context, id string) (*Party, error) {
	party, err := loadPartyWithGuests(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if !RequiredFieldsPresentFor(party) {
		return nil, ErrRequiredFields
	}
	return s.applyCollectionFlags(ctx, party, true, true)
}

// MarkIncomplete is the admin "re-open this party" action: requested=true,
// confirmed=false. It has no gate (re-opening is always allowed).
func (s *Service) MarkIncomplete(ctx context.Context, id string) (*Party, error) {
	return s.setCollectionFlags(ctx, id, true, false)
}

// SubmitInfoForm records a guest's submission of the info form. It is the
// service method behind the (guest-facing) info-collection endpoint built in a
// later issue (#8); there is no guest endpoint here, but the gated transition
// lives and is tested now. Like MarkComplete it is gated on required fields,
// since the form must collect exactly those before it can complete.
func (s *Service) SubmitInfoForm(ctx context.Context, id string) (*Party, error) {
	party, err := loadPartyWithGuests(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	if !RequiredFieldsPresentFor(party) {
		return nil, ErrRequiredFields
	}
	return s.applyCollectionFlags(ctx, party, true, true)
}

// setCollectionFlags loads the party then writes the given flags. It is the
// ungated path used by RequestInfo / MarkIncomplete.
func (s *Service) setCollectionFlags(ctx context.Context, id string, requested, confirmed bool) (*Party, error) {
	party, err := loadPartyWithGuests(ctx, s.db, id)
	if err != nil {
		return nil, err
	}
	return s.applyCollectionFlags(ctx, party, requested, confirmed)
}

// applyCollectionFlags persists the two collection flags (and updated_at) for a
// loaded party, updating only those columns so nothing else is disturbed.
func (s *Service) applyCollectionFlags(ctx context.Context, party *Party, requested, confirmed bool) (*Party, error) {
	party.InfoCollectionRequested = requested
	party.InfoCollectionConfirmed = confirmed
	party.UpdatedAt = time.Now()

	_, err := s.db.NewUpdate().Model(party).
		Column("info_collection_requested", "info_collection_confirmed", "updated_at").
		WherePK().Exec(ctx)
	if err != nil {
		return nil, fmt.Errorf("update collection flags: %w", err)
	}
	return party, nil
}
