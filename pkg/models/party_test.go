package models_test

import (
	"testing"

	"github.com/robinjoseph08/golib/pointerutil"
	"github.com/robinjoseph08/robinandmadeline.com/pkg/models"
	"github.com/stretchr/testify/assert"
)

// These tests pin down the info-collection status state machine (ADR 0005) on
// the Party model, independent of any database. They construct parties in memory
// (with their primary guest and address) to exercise every branch.

// withPrimaryEmail returns a primary guest with the given email (nil for none).
func withPrimaryEmail(email *string) []*models.Guest {
	return []*models.Guest{{IsPrimary: true, Email: email}}
}

// fullAddress sets the five required address fields on a party. Country is the
// US so the postal code is genuinely required (a complete US address), the
// strictest gate.
func fullAddress(p *models.Party) {
	p.AddressLine1 = pointerutil.String("x")
	p.City = pointerutil.String("x")
	p.StateOrProvince = pointerutil.String("x")
	p.PostalCode = pointerutil.String("x")
	p.Country = pointerutil.String("United States")
}

func TestPrimaryGuest(t *testing.T) {
	t.Parallel()

	primary := &models.Guest{IsPrimary: true}
	p := &models.Party{Guests: []*models.Guest{{}, primary, {}}}
	assert.Same(t, primary, p.PrimaryGuest())

	// No primary loaded or assigned reads nil.
	assert.Nil(t, (&models.Party{Guests: []*models.Guest{{}}}).PrimaryGuest())
	assert.Nil(t, (&models.Party{}).PrimaryGuest())
}

func TestRequiredFieldsPresent_Digital(t *testing.T) {
	t.Parallel()

	// A digital party has no required fields now that the primary email is
	// optional for completion, so it is always present-complete: email (present,
	// blank, or absent) and the irrelevant address never change the outcome.
	tests := []struct {
		name        string
		email       *string
		withAddress bool
	}{
		{"no primary", nil, false},
		{"email present", pointerutil.String("a@b.com"), false},
		{"blank email", pointerutil.String("   "), false},
		{"address ignored", pointerutil.String("a@b.com"), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			p := &models.Party{InvitationType: models.InvitationDigital}
			if tt.email != nil {
				p.Guests = withPrimaryEmail(tt.email)
			}
			if tt.withAddress {
				fullAddress(p)
			}
			assert.True(t, p.RequiredFieldsPresent())
		})
	}
}

func TestRequiredFieldsPresent_Physical(t *testing.T) {
	t.Parallel()

	// A physical party needs a full mailing address; the primary email is no
	// longer required for completion (the info form still asks for it), so the
	// address alone decides the outcome.
	tests := []struct {
		name        string
		email       *string
		withAddress bool
		want        bool
	}{
		{"neither", nil, false, false},
		{"email but no address", pointerutil.String("a@b.com"), false, false},
		{"address but no email", nil, true, true},
		{"both", pointerutil.String("a@b.com"), true, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			p := &models.Party{InvitationType: models.InvitationPhysical}
			if tt.email != nil {
				p.Guests = withPrimaryEmail(tt.email)
			}
			if tt.withAddress {
				fullAddress(p)
			}
			assert.Equal(t, tt.want, p.RequiredFieldsPresent())
		})
	}
}

func TestMissingRequiredFields_ItemizesWhatTheGateChecks(t *testing.T) {
	t.Parallel()

	// A digital party has no required fields, so nothing is ever missing (the
	// primary email is not among them now that it is optional for completion).
	digital := &models.Party{InvitationType: models.InvitationDigital}
	assert.Empty(t, digital.MissingRequiredFields())

	// A US physical party itemizes each absent address field, the postal code
	// included (line 2 is optional and never listed; the primary email is not a
	// required field at all, so it never appears either).
	physical := &models.Party{InvitationType: models.InvitationPhysical}
	physical.AddressLine1 = pointerutil.String("123 Main St")
	physical.Country = pointerutil.String("United States")
	physical.PostalCode = pointerutil.String("   ") // blank counts as absent
	assert.Equal(t,
		[]string{"city", "state or province", "postal code"},
		physical.MissingRequiredFields())

	// A complete party misses nothing: the list is empty (and non-nil, so it
	// serializes as []), which is exactly RequiredFieldsPresent.
	fullAddress(physical)
	assert.NotNil(t, physical.MissingRequiredFields())
	assert.Empty(t, physical.MissingRequiredFields())
	assert.True(t, physical.RequiredFieldsPresent())
}

func TestMissingRequiredFields_PostalCodeOptionalAbroad(t *testing.T) {
	t.Parallel()

	// The street, city, and state/province of an international address, with no
	// postal code and no country yet.
	base := func() *models.Party {
		p := &models.Party{InvitationType: models.InvitationPhysical}
		p.Guests = withPrimaryEmail(pointerutil.String("a@b.com"))
		p.AddressLine1 = pointerutil.String("123 King St")
		p.City = pointerutil.String("Toronto")
		p.StateOrProvince = pointerutil.String("ON")
		return p
	}

	// A non-US country with no postal code is still complete: many countries
	// (Hong Kong, the UAE, Qatar, ...) have none, so the gate doesn't ask.
	intl := base()
	intl.Country = pointerutil.String("Canada")
	assert.Empty(t, intl.MissingRequiredFields())
	assert.True(t, intl.RequiredFieldsPresent())

	// The very same address as a US party does require the postal code, matched
	// case-insensitively against the canonical country name.
	us := base()
	us.Country = pointerutil.String("united states")
	assert.Equal(t, []string{"postal code"}, us.MissingRequiredFields())

	// A not-yet-known (blank) country isn't gated on the postal code either, but
	// the country itself is still missing until the guest fills it in.
	unknown := base()
	assert.Equal(t, []string{"country"}, unknown.MissingRequiredFields())
}

func TestInfoCollectionStatus_NotRequested_DerivedFromFields(t *testing.T) {
	t.Parallel()

	// requested=false: status is derived purely from field presence, regardless
	// of the confirmed flag (a stale confirmed must not leak through). For a
	// physical party the address is what's derived on; the primary email no
	// longer affects it.
	tests := []struct {
		name      string
		confirmed bool
		email     *string
		address   bool
		want      string
	}{
		{"complete when address present", false, pointerutil.String("a@b.com"), true, models.StatusComplete},
		{"complete even when email missing", false, nil, true, models.StatusComplete},
		{"incomplete when address missing", false, pointerutil.String("a@b.com"), false, models.StatusIncomplete},
		{"confirmed flag ignored when not requested", true, nil, false, models.StatusIncomplete},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			p := &models.Party{InvitationType: models.InvitationPhysical, InfoCollectionConfirmed: tt.confirmed}
			if tt.email != nil {
				p.Guests = withPrimaryEmail(tt.email)
			}
			if tt.address {
				fullAddress(p)
			}
			assert.Equal(t, tt.want, p.InfoCollectionStatus())
		})
	}
}

func TestInfoCollectionStatus_Digital_CompleteUntilRequested(t *testing.T) {
	t.Parallel()

	// A digital party has no required fields (email is optional for completion,
	// and there is no address), so before the info link is sent it derives
	// complete outright, even with no primary guest at all.
	empty := &models.Party{InvitationType: models.InvitationDigital}
	assert.Equal(t, models.StatusComplete, empty.InfoCollectionStatus())

	noEmail := &models.Party{
		InvitationType: models.InvitationDigital,
		Guests:         []*models.Guest{{IsPrimary: true}},
	}
	assert.Equal(t, models.StatusComplete, noEmail.InfoCollectionStatus())

	// Sending the link (requested) still resets it to waiting until confirmed,
	// exactly as for a physical party.
	requested := &models.Party{InvitationType: models.InvitationDigital, InfoCollectionRequested: true}
	assert.Equal(t, models.StatusIncomplete, requested.InfoCollectionStatus())
}

func TestInfoCollectionStatus_Requested_FollowsConfirmedFlag(t *testing.T) {
	t.Parallel()

	// requested=true: status is affirmed, so it follows confirmed and ignores
	// whether the fields happen to be present (the guest must submit / admin must
	// mark).
	tests := []struct {
		name      string
		confirmed bool
		want      string
	}{
		{"incomplete while waiting even if fields present", false, models.StatusIncomplete},
		{"complete once confirmed", true, models.StatusComplete},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			p := &models.Party{
				InvitationType:          models.InvitationPhysical,
				InfoCollectionRequested: true,
				InfoCollectionConfirmed: tt.confirmed,
				Guests:                  withPrimaryEmail(pointerutil.String("a@b.com")),
			}
			fullAddress(p)
			assert.Equal(t, tt.want, p.InfoCollectionStatus())
		})
	}
}
