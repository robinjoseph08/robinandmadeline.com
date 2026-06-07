package parties

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"

	"github.com/pkg/errors"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/errcodes"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
)

// infoTokenBytes is the entropy (in bytes) behind a generated info token. 24
// bytes is 192 bits and base64url-encodes to a compact, URL-safe string.
const infoTokenBytes = 24

// validSides, validRelations, and validInvitationTypes mirror the schema CHECK
// constraints so invalid input is rejected at the API layer with a clear message
// rather than surfacing a raw constraint violation.
var (
	validSides           = map[string]bool{models.SideRobin: true, models.SideMadeline: true}
	validRelations       = map[string]bool{models.RelationFamily: true, models.RelationFriend: true}
	validInvitationTypes = map[string]bool{models.InvitationPhysical: true, models.InvitationDigital: true}
)

// validatePartyEnums checks the three enum-like party fields, returning a 422
// naming the bad field.
func validatePartyEnums(side, relation, invitationType string) error {
	if !validSides[side] {
		return errcodes.ValidationError(fmt.Sprintf("invalid side %q: must be one of robin, madeline", side))
	}
	if !validRelations[relation] {
		return errcodes.ValidationError(fmt.Sprintf("invalid relation %q: must be one of family, friend", relation))
	}
	if !validInvitationTypes[invitationType] {
		return errcodes.ValidationError(fmt.Sprintf("invalid invitation_type %q: must be one of physical, digital", invitationType))
	}
	return nil
}

// generateInfoToken returns a random, opaque, URL-safe token for a party's
// info-collection link. Tokens use crypto/rand; the service retries on the
// astronomically unlikely unique-index collision.
func generateInfoToken() (string, error) {
	b := make([]byte, infoTokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", errors.Wrap(err, "generate info token")
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// trimmedOrNil trims an optional text field and collapses an empty result to
// nil, so blank input is stored as SQL NULL rather than "". This keeps the
// "present" checks in the status logic honest.
func trimmedOrNil(s *string) *string {
	if s == nil {
		return nil
	}
	t := strings.TrimSpace(*s)
	if t == "" {
		return nil
	}
	return &t
}
