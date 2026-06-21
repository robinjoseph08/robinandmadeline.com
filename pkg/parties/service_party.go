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

// CreateParty inserts a party, generating a unique info token. No handler calls
// it: it exists to build test fixtures, sharing insertPartyWithUniqueToken with
// the public create path, CreatePartyWithGuest, which guarantees a party is
// born with its first guest. The payload is already bound, trimmed,
// defaulted, and validated by the binder, so the fields are assigned directly;
// circle arrives as a non-nil slice (defaulted to []) so it stores '{}', not
// NULL. A supplied RSVP code that is already taken yields a 409. An omitted
// optional field is nil and persists as SQL NULL, except rsvp_code: a nil code
// is auto-generated, so a party is always created with one.
func (s *Service) CreateParty(ctx context.Context, in CreatePartyPayload) (*models.Party, error) {
	now := time.Now()
	party := &models.Party{
		ID:              newID(),
		Name:            in.Name,
		Side:            in.Side,
		Relation:        in.Relation,
		Circle:          in.Circle,
		InvitationType:  in.InvitationType,
		AddressLine1:    in.AddressLine1,
		AddressLine2:    in.AddressLine2,
		City:            in.City,
		StateOrProvince: in.StateOrProvince,
		PostalCode:      in.PostalCode,
		Country:         in.Country,
		RSVPCode:        in.RSVPCode,
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	if err := insertPartyWithUniqueToken(ctx, s.db, party, in.RSVPCode != nil); err != nil {
		return nil, err
	}
	return party, nil
}

// CreatePartyWithGuest creates a party together with its first guest in one
// transaction, the public create path (POST /parties). The party is never left
// without a member, and the first guest is forced primary, seeding the
// single-primary invariant. invitation_type has already been defaulted to
// "physical" by the binder when omitted. A taken RSVP code yields a 409, and an
// omitted one is auto-generated, so the party is born ready to RSVP; if the
// insert fails the whole thing rolls back, so a failed guest insert never leaves
// an empty party behind. The returned party carries its guest so the response
// status derives correctly.
func (s *Service) CreatePartyWithGuest(ctx context.Context, in CreatePartyWithGuestPayload) (*models.Party, error) {
	now := time.Now()
	party := &models.Party{
		ID:             newID(),
		Name:           in.Name,
		Side:           in.Side,
		Relation:       in.Relation,
		Circle:         in.Circle,
		InvitationType: in.InvitationType,
		RSVPCode:       in.RSVPCode,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	guest := &models.Guest{
		ID:              newID(),
		PartyID:         party.ID,
		FullName:        in.Guest.FullName,
		Email:           in.Guest.Email,
		Phone:           in.Guest.Phone,
		Tags:            in.Guest.Tags,
		IsPrimary:       true, // the first guest is always the party's primary
		IsChild:         in.Guest.IsChild,
		IsDrinking:      in.Guest.IsDrinking,
		PlaceholderText: in.Guest.PlaceholderText,
		Subscribed:      true, // the first guest is born subscribed (ADR 0009)
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	err := s.db.RunInTx(ctx, &sql.TxOptions{}, func(ctx context.Context, tx bun.Tx) error {
		if err := insertPartyWithUniqueToken(ctx, tx, party, in.RSVPCode != nil); err != nil {
			return err
		}
		if _, err := tx.NewInsert().Model(guest).Exec(ctx); err != nil {
			return errors.Wrap(err, "insert first guest")
		}
		// The first guest is born invited to every public event (ADR 0002): the
		// backfill shares this transaction so the party, its guest, and their
		// pending Event RSVPs appear atomically.
		return events.BackfillPublicEventRSVPs(ctx, tx, guest.ID)
	})
	if err != nil {
		return nil, err
	}
	party.Guests = []*models.Guest{guest}
	return party, nil
}

// insertPartyWithUniqueToken inserts a party with a unique info token and a
// guaranteed RSVP code: a provided code is kept (after the uniqueness check), a
// nil one is generated, so every create path births a party with a code. It
// takes a bun.IDB so it works on both the pool (CreateParty) and a transaction
// (CreatePartyWithGuest). Uniqueness is checked up front with SELECTs rather than
// by catching a failed INSERT: inside a transaction a failed statement aborts the
// whole transaction (so a follow-up query would error with "current transaction
// is aborted"), which is exactly the path CreatePartyWithGuest exercises. A taken
// provided RSVP code is a clean 409; a taken generated code and an info-token
// collision (astronomically unlikely) just regenerate. The unique indexes remain
// the ultimate backstop against a concurrent racer slipping in between the check
// and the insert; when that backstop fires on the RSVP code, the insert error is
// mapped to the same 409 the up-front check produces (for a generated code that
// retried create draws a fresh one). An insert-time info-token collision stays
// an error: the aborted transaction cannot retry the loop, and 192-bit tokens
// make it not worth handling.
func insertPartyWithUniqueToken(ctx context.Context, db bun.IDB, party *models.Party, rsvpProvided bool) error {
	if rsvpProvided {
		taken, err := isRSVPCodeConflict(ctx, db, party.RSVPCode)
		if err != nil {
			return err
		}
		if taken {
			return errcodes.Conflict("A party with that RSVP code already exists.")
		}
	} else {
		if err := assignGeneratedRSVPCode(ctx, db, party); err != nil {
			return err
		}
	}

	for attempt := 0; attempt < maxTokenAttempts; attempt++ {
		token, err := GenerateInfoToken()
		if err != nil {
			return err
		}
		taken, err := db.NewSelect().Model((*models.Party)(nil)).Where("info_token = ?", token).Exists(ctx)
		if err != nil {
			return errors.Wrap(err, "check info token")
		}
		if taken {
			continue
		}

		party.InfoToken = token
		if _, err := db.NewInsert().Model(party).Exec(ctx); err != nil {
			return errcodes.ConflictOnConstraint(errors.Wrap(err, "insert party"),
				"ux_parties_rsvp_code", "A party with that RSVP code already exists.")
		}
		return nil
	}
	return errors.Errorf("generate unique info token: exhausted %d attempts", maxTokenAttempts)
}

// GetParty loads a single party with its guests, or a 404.
func (s *Service) GetParty(ctx context.Context, id string) (*models.Party, error) {
	return loadPartyWithGuests(ctx, s.db, id)
}

// UpdateParty applies the editable fields to an existing party. It does not touch
// info_token or the info_collection_* flags (status transitions have their own
// methods). A duplicate RSVP code yields a 409, a missing party a 404.
func (s *Service) UpdateParty(ctx context.Context, id string, in UpdatePartyPayload) (*models.Party, error) {
	party, err := loadPartyWithGuests(ctx, s.db, id)
	if err != nil {
		return nil, err
	}

	// The payload is already bound, trimmed, defaulted, and validated by the
	// binder, so the fields are assigned directly. An omitted optional field is
	// nil and persists as SQL NULL.
	party.Name = in.Name
	party.Side = in.Side
	party.Relation = in.Relation
	party.Circle = in.Circle
	party.InvitationType = in.InvitationType
	party.AddressLine1 = in.AddressLine1
	party.AddressLine2 = in.AddressLine2
	party.City = in.City
	party.StateOrProvince = in.StateOrProvince
	party.PostalCode = in.PostalCode
	party.Country = in.Country
	party.RSVPCode = in.RSVPCode
	party.UpdatedAt = time.Now()

	// Update only the editable columns. info_token and the info_collection_*
	// flags are excluded so a field edit can never alter collection status.
	_, err = s.db.NewUpdate().Model(party).
		Column("name", "side", "relation", "circle", "invitation_type",
			"address_line_1", "address_line_2", "city", "state_or_province",
			"postal_code", "country", "rsvp_code", "updated_at").
		WherePK().Exec(ctx)
	if err != nil {
		return nil, errcodes.ConflictOnUnique(errors.Wrap(err, "update party"),
			"A party with that RSVP code already exists.")
	}
	return party, nil
}

// PatchParty applies a partial update: only the fields present in the payload
// (a non-nil pointer, or a non-nil circle slice) are written, each as a single
// column, so a spreadsheet cell edit saves just that field. Like UpdateParty it
// excludes info_token and the info_collection_* flags (ADR 0005), so editing a
// field never changes collection status. A provided nullable text field is
// stored as SQL NULL when blank (pointerutil.EmptyString), which keeps a cleared
// rsvp_code out of the partial unique index. A duplicate RSVP code yields a 409,
// a missing party a 404. With no fields provided it is a no-op returning the
// current party.
func (s *Service) PatchParty(ctx context.Context, id string, in PatchPartyPayload) (*models.Party, error) {
	party, err := loadPartyWithGuests(ctx, s.db, id)
	if err != nil {
		return nil, err
	}

	cols := make([]string, 0, 12)
	if in.Name != nil {
		party.Name = *in.Name
		cols = append(cols, "name")
	}
	if in.Side != nil {
		party.Side = *in.Side
		cols = append(cols, "side")
	}
	if in.Relation != nil {
		party.Relation = *in.Relation
		cols = append(cols, "relation")
	}
	if in.Circle != nil {
		party.Circle = in.Circle
		cols = append(cols, "circle")
	}
	if in.InvitationType != nil {
		party.InvitationType = *in.InvitationType
		cols = append(cols, "invitation_type")
	}
	if in.AddressLine1 != nil {
		party.AddressLine1 = pointerutil.EmptyString(*in.AddressLine1)
		cols = append(cols, "address_line_1")
	}
	if in.AddressLine2 != nil {
		party.AddressLine2 = pointerutil.EmptyString(*in.AddressLine2)
		cols = append(cols, "address_line_2")
	}
	if in.City != nil {
		party.City = pointerutil.EmptyString(*in.City)
		cols = append(cols, "city")
	}
	if in.StateOrProvince != nil {
		party.StateOrProvince = pointerutil.EmptyString(*in.StateOrProvince)
		cols = append(cols, "state_or_province")
	}
	if in.PostalCode != nil {
		party.PostalCode = pointerutil.EmptyString(*in.PostalCode)
		cols = append(cols, "postal_code")
	}
	if in.Country != nil {
		party.Country = pointerutil.EmptyString(*in.Country)
		cols = append(cols, "country")
	}
	if in.RSVPCode != nil {
		party.RSVPCode = pointerutil.EmptyString(*in.RSVPCode)
		cols = append(cols, "rsvp_code")
	}

	// Nothing to change: return the loaded party without a write.
	if len(cols) == 0 {
		return party, nil
	}

	party.UpdatedAt = time.Now()
	cols = append(cols, "updated_at")

	// Update only the provided columns. info_token and the info_collection_* flags
	// are never in the set, so a field edit can never alter collection status.
	_, err = s.db.NewUpdate().Model(party).Column(cols...).WherePK().Exec(ctx)
	if err != nil {
		return nil, errcodes.ConflictOnUnique(errors.Wrap(err, "patch party"),
			"A party with that RSVP code already exists.")
	}
	return party, nil
}

// DeleteParty removes a party; its guests go via the FK cascade. Deleting a
// non-existent party returns a 404.
func (s *Service) DeleteParty(ctx context.Context, id string) error {
	res, err := s.db.NewDelete().Model((*models.Party)(nil)).Where("id = ?", id).Exec(ctx)
	if err != nil {
		return errors.Wrap(err, "delete party")
	}
	n, err := res.RowsAffected()
	if err != nil {
		return errors.Wrap(err, "delete party rows affected")
	}
	if n == 0 {
		return errcodes.NotFound("party")
	}
	return nil
}

// assignGeneratedRSVPCode fills party.RSVPCode with a freshly generated code no
// existing party holds, so a create that supplies no code still yields a party
// guests can RSVP with. Mirroring the info-token loop, uniqueness is checked
// with a SELECT and a taken code just regenerates (bounded attempts): a failed
// INSERT could not be retried inside CreatePartyWithGuest's transaction, so
// collisions are caught before the insert and the partial unique index stays
// the backstop against a concurrent racer.
func assignGeneratedRSVPCode(ctx context.Context, db bun.IDB, party *models.Party) error {
	for attempt := 0; attempt < maxRSVPCodeAttempts; attempt++ {
		code, err := GenerateRSVPCode()
		if err != nil {
			return err
		}
		taken, err := db.NewSelect().Model((*models.Party)(nil)).Where("rsvp_code = ?", code).Exists(ctx)
		if err != nil {
			return errors.Wrap(err, "check rsvp code")
		}
		if taken {
			continue
		}
		party.RSVPCode = pointerutil.String(code)
		return nil
	}
	return errors.Errorf("generate unique rsvp code: exhausted %d attempts", maxRSVPCodeAttempts)
}

// isRSVPCodeConflict reports whether some party already holds the given RSVP
// code, giving a provided code a clean 409 before the insert. A query failure
// propagates rather than silently degrading the pre-check to "no conflict".
func isRSVPCodeConflict(ctx context.Context, db bun.IDB, code *string) (bool, error) {
	if code == nil {
		return false, nil
	}
	exists, err := db.NewSelect().Model((*models.Party)(nil)).Where("rsvp_code = ?", *code).Exists(ctx)
	if err != nil {
		return false, errors.Wrap(err, "check rsvp code conflict")
	}
	return exists, nil
}
