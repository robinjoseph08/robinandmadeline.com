package parties

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// These tests pin down the info-collection status state machine (ADR 0005)
// against the pure decision function, independent of any database. The function
// is the single source of truth reused by API responses, the status filter, and
// the mark-complete gate, so its behavior is tested exhaustively here.

func TestRequiredFieldsPresent_Digital(t *testing.T) {
	t.Parallel()

	// A digital party needs only the primary guest's email; address is
	// irrelevant, so requiredAddressPresent does not affect the outcome.
	tests := []struct {
		name                   string
		primaryEmailPresent    bool
		requiredAddressPresent bool
		want                   bool
	}{
		{"no email", false, false, false},
		{"email present", true, false, true},
		{"email present, address ignored", true, true, true},
		{"address present but no email", false, true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := RequiredFieldsPresent(InvitationDigital, tt.primaryEmailPresent, tt.requiredAddressPresent)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestRequiredFieldsPresent_Physical(t *testing.T) {
	t.Parallel()

	// A physical party needs both the primary email AND a full mailing address.
	tests := []struct {
		name                   string
		primaryEmailPresent    bool
		requiredAddressPresent bool
		want                   bool
	}{
		{"neither", false, false, false},
		{"email only", true, false, false},
		{"address only", false, true, false},
		{"both", true, true, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := RequiredFieldsPresent(InvitationPhysical, tt.primaryEmailPresent, tt.requiredAddressPresent)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestStatus_NotRequested_DerivedFromFields(t *testing.T) {
	t.Parallel()

	// requested=false: status is derived purely from field presence, regardless
	// of the confirmed flag (a stale confirmed should not leak through).
	tests := []struct {
		name      string
		confirmed bool
		email     bool
		address   bool
		want      string
	}{
		{"complete when all required present", false, true, true, StatusComplete},
		{"incomplete when email missing", false, false, true, StatusIncomplete},
		{"incomplete when address missing", false, true, false, StatusIncomplete},
		{"confirmed flag ignored when not requested", true, false, false, StatusIncomplete},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			p := &Party{InvitationType: InvitationPhysical, InfoCollectionRequested: false, InfoCollectionConfirmed: tt.confirmed}
			got := Status(p, tt.email, tt.address)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestStatus_Requested_FollowsConfirmedFlag(t *testing.T) {
	t.Parallel()

	// requested=true: status is affirmed, so it follows confirmed and ignores
	// whether the fields happen to be present (the guest must submit / admin must
	// mark).
	tests := []struct {
		name      string
		confirmed bool
		email     bool
		address   bool
		want      string
	}{
		{"incomplete while waiting even if fields present", false, true, true, StatusIncomplete},
		{"complete once confirmed", true, true, true, StatusComplete},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			p := &Party{InvitationType: InvitationPhysical, InfoCollectionRequested: true, InfoCollectionConfirmed: tt.confirmed}
			got := Status(p, tt.email, tt.address)
			assert.Equal(t, tt.want, got)
		})
	}
}
