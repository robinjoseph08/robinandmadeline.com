// Package info is the guest-facing pre-invitation info-collection flow: the
// API behind the personalized /i/:token URL a party uses to confirm and
// correct its contact details before invitations go out. There is no JWT; the
// party's opaque info token (ADR 0003) is the authentication, so the routes
// mount on the open API group. Reads return the party's address and its known
// guests with their contact details; writes apply the whole form at once
// (per-guest name corrections, email/phone, per-guest removal, and the
// party-level address), gated on the invitation type's required fields, and a
// successful submit confirms the party's info collection (ADR 0005).
//
// Placeholder guests (unnamed plus-one slots) are invisible to this flow on
// both read and write: info collection is about the people the couple already
// knows, and the slots first surface in the RSVP flow (pkg/rsvps), where they
// are named. The admin-facing status transitions live in pkg/parties; the
// persistent models live in pkg/models.
package info

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

// Service is the info-collection data layer over a Bun DB. Construct it with
// NewService. Methods take the party's info token (from the URL) and never
// reach beyond that party's rows. Methods return errcodes errors directly;
// handlers pass them through to the shared error handler.
type Service struct {
	db *bun.DB
}

// NewService builds a Service backed by the given Bun DB.
func NewService(db *bun.DB) *Service {
	return &Service{db: db}
}

// PartyInfo assembles the GET /api/info/:token view: the token's party (its
// invitation type and mailing address) and its known guests in creation order
// with their contact details. Placeholder guests are excluded server-side. An
// unknown token is a 404.
func (s *Service) PartyInfo(ctx context.Context, token string) (*PartyInfoResponse, error) {
	return partyInfo(ctx, s.db, token)
}

// partyInfo is PartyInfo over any query context, so UpdatePartyInfo can return
// the refreshed view from inside its own transaction (reading its
// still-uncommitted writes).
func partyInfo(ctx context.Context, db bun.IDB, token string) (*PartyInfoResponse, error) {
	party, err := partyByToken(ctx, db, token, false)
	if err != nil {
		return nil, err
	}
	guests, err := partyGuests(ctx, db, party.ID)
	if err != nil {
		return nil, err
	}
	return newPartyInfoResponse(party, guests), nil
}

// newPartyInfoResponse projects a loaded party and its guests onto the
// response shape.
func newPartyInfoResponse(party *models.Party, guests []*models.Guest) *PartyInfoResponse {
	resp := &PartyInfoResponse{
		InvitationType:  party.InvitationType,
		AddressLine1:    party.AddressLine1,
		AddressLine2:    party.AddressLine2,
		City:            party.City,
		StateOrProvince: party.StateOrProvince,
		PostalCode:      party.PostalCode,
		Country:         party.Country,
		Guests:          make([]Guest, 0, len(guests)),
	}
	for _, g := range guests {
		resp.Guests = append(resp.Guests, newGuestView(g))
	}
	return resp
}

// partyByToken loads the party owning the given info token, or a 404. The 404
// names the party resource without echoing the token, so an enumeration probe
// learns nothing. forUpdate locks the row (FOR UPDATE) for the submit path,
// where the completion gate and the flag write must not race a concurrent
// edit (the same locking confirmComplete uses in pkg/parties, ADR 0005).
func partyByToken(ctx context.Context, db bun.IDB, token string, forUpdate bool) (*models.Party, error) {
	party := new(models.Party)
	q := db.NewSelect().Model(party).Where("p.info_token = ?", token)
	if forUpdate {
		q = q.For("UPDATE")
	}
	if err := q.Scan(ctx); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, errcodes.NotFound("party")
		}
		return nil, errors.Wrap(err, "load party by info token")
	}
	return party, nil
}

// partyGuests lists a party's known guests in creation order (the stable
// order the form and the admin views share). Placeholder guests (a non-null
// placeholder_text) are excluded at the query, which makes them invisible to
// the whole flow: they never appear in a response, and because the submit
// path resolves guest ids against this list, an update or removal addressing
// one is rejected exactly like a guest from another party.
func partyGuests(ctx context.Context, db bun.IDB, partyID string) ([]*models.Guest, error) {
	var guests []*models.Guest
	err := db.NewSelect().Model(&guests).
		Where("g.party_id = ?", partyID).
		Where("g.placeholder_text IS NULL").
		Order("g.created_at ASC", "g.id ASC").
		Scan(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "list party guests")
	}
	return guests, nil
}

// UpdatePartyInfo applies one whole info-form submission for the token's
// party: per-guest name corrections and contact details, per-guest removals,
// and the party-level address, all in one transaction so a rejected submit
// persists nothing. After the writes it enforces the completion gate
// (models.Party.RequiredFieldsPresent, ADR 0005): a submit leaving the party's
// required fields missing is a 422 and rolls everything back, while a
// successful one confirms the party (requested=true, confirmed=true), the
// guest-submission counterpart of the admin MarkComplete. The party row is
// locked for the duration so a concurrent edit cannot slip between the gate
// and the confirmation. On success it returns the refreshed view, read inside
// the same transaction.
func (s *Service) UpdatePartyInfo(ctx context.Context, token string, in UpdatePartyInfoPayload) (*PartyInfoResponse, error) {
	resp := new(PartyInfoResponse)
	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		party, err := partyByToken(ctx, tx, token, true)
		if err != nil {
			return err
		}
		guests, err := partyGuests(ctx, tx, party.ID)
		if err != nil {
			return err
		}
		byID := make(map[string]*models.Guest, len(guests))
		for _, g := range guests {
			byID[g.ID] = g
		}

		now := time.Now()
		for _, update := range in.Guests {
			guest, ok := byID[update.GuestID]
			if !ok {
				// Never reveal whether the id exists in some other party, or names
				// one of this party's placeholder slots (invisible to this flow);
				// either way it is not addressable here.
				return errcodes.ValidationError("One or more guests do not belong to your party.")
			}
			if update.Remove {
				if err := removeGuest(ctx, tx, guest); err != nil {
					return err
				}
				// A removed guest is no longer addressable by a later entry.
				delete(byID, guest.ID)
				continue
			}
			if err := applyGuestInfo(ctx, tx, guest, update, now); err != nil {
				return err
			}
		}

		if err := applyPartyAddress(ctx, tx, party, in, now); err != nil {
			return err
		}

		// The completion gate (ADR 0005): the form must collect exactly the
		// invitation type's required fields, so an under-filled submit is
		// rejected and the transaction rolls back. The gate reads the
		// still-uncommitted writes, i.e. the party as the submit would leave it.
		gated, err := partyByToken(ctx, tx, token, false)
		if err != nil {
			return err
		}
		if gated.Guests, err = partyGuests(ctx, tx, party.ID); err != nil {
			return err
		}
		if !gated.RequiredFieldsPresent() {
			return errcodes.ValidationError("Required contact details are missing; please fill in every required field.")
		}

		// A successful submit confirms the party: requested records that the
		// link was evidently delivered, confirmed that the guest affirmed the
		// data, together deriving the complete status (ADR 0005).
		_, err = tx.NewUpdate().Model(gated).
			Set("info_collection_requested = TRUE").
			Set("info_collection_confirmed = TRUE").
			Set("updated_at = ?", now).
			WherePK().Exec(ctx)
		if err != nil {
			return errors.Wrap(err, "confirm info collection")
		}

		refreshed, err := partyInfo(ctx, tx, token)
		if err != nil {
			return err
		}
		*resp = *refreshed
		return nil
	})
	if err != nil {
		return nil, err
	}
	return resp, nil
}

// removeGuest deletes a non-primary guest inside the caller's transaction;
// their Event RSVPs go with them (the guests FK cascades). The primary guest
// is the party's point of contact and cannot be removed. Because the primary
// always survives, a removal can never empty the party or strand it
// primary-less, so no mend (delete-if-empty, re-primary) is needed here,
// unlike the admin DeleteGuest.
func removeGuest(ctx context.Context, tx bun.Tx, guest *models.Guest) error {
	if guest.IsPrimary {
		return errcodes.ValidationError("The primary contact cannot be removed from the party.")
	}
	if _, err := tx.NewDelete().Model((*models.Guest)(nil)).Where("id = ?", guest.ID).Exec(ctx); err != nil {
		return errors.Wrap(err, "remove guest")
	}
	return nil
}

// applyGuestInfo writes one guest's submission inside the caller's
// transaction: the corrected name (per the rules on GuestInfoUpdate) and the
// full-state contact details (blank normalizes to NULL via
// pointerutil.EmptyString so the columns never mix "" and NULL, matching the
// admin PATCH path's cleared-cell convention).
func applyGuestInfo(ctx context.Context, tx bun.Tx, guest *models.Guest, update GuestInfoUpdate, now time.Time) error {
	if err := applyName(guest, update.FullName); err != nil {
		return err
	}

	guest.Email = nil
	if update.Email != nil {
		guest.Email = pointerutil.EmptyString(*update.Email)
	}
	guest.Phone = nil
	if update.Phone != nil {
		guest.Phone = pointerutil.EmptyString(*update.Phone)
	}
	// Subscription is independent of email presence (ADR 0009): an omitted value
	// leaves it untouched, a present one sets it, so the primary's required email
	// can be on file while they stay unsubscribed.
	if update.Subscribed != nil {
		guest.Subscribed = *update.Subscribed
	}
	guest.UpdatedAt = now

	_, err := tx.NewUpdate().Model(guest).
		Column("full_name", "email", "phone", "subscribed", "updated_at").
		WherePK().Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "update guest info")
	}
	return nil
}

// applyName resolves a submitted full_name (already trimmed by the binder)
// onto the guest: a non-blank value corrects it, an absent one leaves it
// untouched, and a present-but-blank value is a 422 (the name of a known
// person can be corrected, never cleared). Only known guests reach here:
// placeholder slots, whose naming rules belong to the RSVP flow, are filtered
// out before ids are resolved.
func applyName(guest *models.Guest, fullName *string) error {
	if fullName == nil {
		return nil
	}
	if *fullName == "" {
		return errcodes.ValidationError("A guest's name cannot be blank.")
	}
	guest.FullName = *fullName
	return nil
}

// applyPartyAddress writes the party-level address fields inside the caller's
// transaction: a present field is stored (blank clears to NULL), an absent one
// is left untouched (the digital form never renders the section, and its
// submit must not wipe an address the couple entered by hand).
func applyPartyAddress(ctx context.Context, tx bun.Tx, party *models.Party, in UpdatePartyInfoPayload, now time.Time) error {
	fields := []struct {
		value  *string
		target **string
	}{
		{in.AddressLine1, &party.AddressLine1},
		{in.AddressLine2, &party.AddressLine2},
		{in.City, &party.City},
		{in.StateOrProvince, &party.StateOrProvince},
		{in.PostalCode, &party.PostalCode},
		{in.Country, &party.Country},
	}
	changed := false
	for _, f := range fields {
		if f.value != nil {
			*f.target = pointerutil.EmptyString(*f.value)
			changed = true
		}
	}
	if !changed {
		return nil
	}

	party.UpdatedAt = now
	_, err := tx.NewUpdate().Model(party).
		Column("address_line_1", "address_line_2", "city", "state_or_province",
			"postal_code", "country", "updated_at").
		WherePK().Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "update party address")
	}
	return nil
}
