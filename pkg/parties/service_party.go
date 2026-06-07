package parties

import (
	"context"
	"strings"
	"time"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/uptrace/bun"
)

// CreateParty validates and inserts a party, generating a unique info token. A
// supplied RSVP code that is already taken yields a 409.
func (s *Service) CreateParty(ctx context.Context, in CreatePartyPayload) (*models.Party, error) {
	if err := validatePartyEnums(in.Side, in.Relation, in.InvitationType); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.Name) == "" {
		return nil, errcodes.ValidationError("name is required")
	}

	now := time.Now()
	party := &models.Party{
		ID:              newID(),
		Name:            strings.TrimSpace(in.Name),
		Side:            in.Side,
		Relation:        in.Relation,
		Circle:          normalizeStringSlice(in.Circle),
		InvitationType:  in.InvitationType,
		AddressLine1:    trimmedOrNil(in.AddressLine1),
		AddressLine2:    trimmedOrNil(in.AddressLine2),
		City:            trimmedOrNil(in.City),
		StateOrProvince: trimmedOrNil(in.StateOrProvince),
		PostalCode:      trimmedOrNil(in.PostalCode),
		Country:         trimmedOrNil(in.Country),
		RSVPCode:        trimmedOrNil(in.RSVPCode),
		CreatedAt:       now,
		UpdatedAt:       now,
	}

	// Generate a unique info token, retrying only on a token collision. Any other
	// unique conflict (the RSVP code) is the caller's input and is reported as a
	// 409 immediately rather than retried.
	for attempt := 0; attempt < maxTokenAttempts; attempt++ {
		token, err := generateInfoToken()
		if err != nil {
			return nil, err
		}
		party.InfoToken = token

		_, err = s.db.NewInsert().Model(party).Exec(ctx)
		if err == nil {
			return party, nil
		}
		if errcodes.IsUniqueViolation(err) {
			// Distinguish an RSVP-code conflict (caller's fault, do not retry) from
			// an info-token collision (retry with a new token).
			if in.RSVPCode != nil && isRSVPCodeConflict(ctx, s.db, party.RSVPCode) {
				return nil, errcodes.Conflict("a party with that RSVP code already exists")
			}
			continue
		}
		return nil, errors.Wrap(err, "insert party")
	}
	return nil, errors.Errorf("generate unique info token: exhausted %d attempts", maxTokenAttempts)
}

// GetParty loads a single party with its guests, or a 404.
func (s *Service) GetParty(ctx context.Context, id string) (*models.Party, error) {
	return loadPartyWithGuests(ctx, s.db, id)
}

// UpdateParty applies the editable fields to an existing party. It does not touch
// info_token or the info_collection_* flags (status transitions have their own
// methods). A duplicate RSVP code yields a 409, a missing party a 404.
func (s *Service) UpdateParty(ctx context.Context, id string, in UpdatePartyPayload) (*models.Party, error) {
	if err := validatePartyEnums(in.Side, in.Relation, in.InvitationType); err != nil {
		return nil, err
	}
	if strings.TrimSpace(in.Name) == "" {
		return nil, errcodes.ValidationError("name is required")
	}

	party, err := loadPartyWithGuests(ctx, s.db, id)
	if err != nil {
		return nil, err
	}

	party.Name = strings.TrimSpace(in.Name)
	party.Side = in.Side
	party.Relation = in.Relation
	party.Circle = normalizeStringSlice(in.Circle)
	party.InvitationType = in.InvitationType
	party.AddressLine1 = trimmedOrNil(in.AddressLine1)
	party.AddressLine2 = trimmedOrNil(in.AddressLine2)
	party.City = trimmedOrNil(in.City)
	party.StateOrProvince = trimmedOrNil(in.StateOrProvince)
	party.PostalCode = trimmedOrNil(in.PostalCode)
	party.Country = trimmedOrNil(in.Country)
	party.RSVPCode = trimmedOrNil(in.RSVPCode)
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
			"a party with that RSVP code already exists")
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

// isRSVPCodeConflict reports whether some party already holds the given RSVP
// code, used to classify a unique violation during create as an RSVP-code
// conflict versus an info-token collision.
func isRSVPCodeConflict(ctx context.Context, db bun.IDB, code *string) bool {
	if code == nil {
		return false
	}
	exists, err := db.NewSelect().Model((*models.Party)(nil)).Where("rsvp_code = ?", *code).Exists(ctx)
	if err != nil {
		return false
	}
	return exists
}

// normalizeStringSlice guarantees a non-nil slice (so a text[] column stores an
// empty array, never NULL) and trims blank entries. Order is preserved.
func normalizeStringSlice(in []string) []string {
	out := make([]string, 0, len(in))
	for _, v := range in {
		if t := strings.TrimSpace(v); t != "" {
			out = append(out, t)
		}
	}
	return out
}
