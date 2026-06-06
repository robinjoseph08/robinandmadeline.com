package parties

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"strings"
)

// infoTokenBytes is the entropy (in bytes) behind a generated info token. 24
// bytes is 192 bits, far beyond guessable, and base64url-encodes to a compact,
// URL-safe string with no padding.
const infoTokenBytes = 24

// validSides, validRelations, and validInvitationTypes mirror the schema CHECK
// constraints so invalid input is rejected at the API layer with a clear
// message rather than surfacing a raw database constraint violation.
var (
	validSides           = map[string]bool{SideRobin: true, SideMadeline: true}
	validRelations       = map[string]bool{RelationFamily: true, RelationFriend: true}
	validInvitationTypes = map[string]bool{InvitationPhysical: true, InvitationDigital: true}
)

// validatePartyEnums checks the three enum-like party fields. It returns a
// human-readable error naming the bad field, which handlers surface as a 400.
func validatePartyEnums(side, relation, invitationType string) error {
	if !validSides[side] {
		return fmt.Errorf("invalid side %q: must be one of robin, madeline", side)
	}
	if !validRelations[relation] {
		return fmt.Errorf("invalid relation %q: must be one of family, friend", relation)
	}
	if !validInvitationTypes[invitationType] {
		return fmt.Errorf("invalid invitation_type %q: must be one of physical, digital", invitationType)
	}
	return nil
}

// generateInfoToken returns a random, opaque, URL-safe token for a party's
// info-collection link. Tokens use crypto/rand so they are unguessable; the
// service retries generation on the (astronomically unlikely) unique-index
// collision.
func generateInfoToken() (string, error) {
	b := make([]byte, infoTokenBytes)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("generate info token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// trimmedOrNil normalizes an optional text field: it trims surrounding
// whitespace and collapses an empty result to nil, so blank input is stored as
// SQL NULL rather than an empty string. This keeps the "present" checks in the
// status logic honest.
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
