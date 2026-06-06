package parties

import "strings"

// This file is the single home of the info-collection status rules (ADR 0005).
// The decision is expressed once, in pure functions over plain inputs, and
// reused by: the derived status in API responses, the status list-filter, the
// mark-complete gate, and the (later) info-form submission. Nothing else should
// re-encode these rules.

// RequiredFieldsPresent reports whether a party has every field required to be
// markable complete, given whether the primary guest's email is present and
// whether a full mailing address is present.
//
// Every party requires the primary guest's email. Physical parties additionally
// require the full mailing address; for digital parties the address is
// irrelevant and requiredAddressPresent is ignored. This is the single gate on
// completion: confirmed may be set true, and status may read complete, only when
// this returns true.
func RequiredFieldsPresent(invitationType string, primaryEmailPresent, requiredAddressPresent bool) bool {
	if !primaryEmailPresent {
		return false
	}
	if invitationType == InvitationPhysical {
		return requiredAddressPresent
	}
	return true
}

// Status derives a party's info-collection status from its stored flags and the
// presence of its required fields (ADR 0005):
//
//   - requested=false: status is DERIVED from the data alone, complete iff all
//     required fields are present. The confirmed flag is ignored here so stale
//     data never reads as affirmed.
//   - requested=true: status is AFFIRMED, complete iff confirmed=true. Because
//     confirmed can only be set when required fields are present, a complete
//     affirmed party necessarily has its required fields too.
//
// In both branches the invariant holds: a party is complete only when its
// required fields are present.
func Status(p *Party, primaryEmailPresent, requiredAddressPresent bool) string {
	if p.InfoCollectionRequested {
		if p.InfoCollectionConfirmed {
			return StatusComplete
		}
		return StatusIncomplete
	}
	if RequiredFieldsPresent(p.InvitationType, primaryEmailPresent, requiredAddressPresent) {
		return StatusComplete
	}
	return StatusIncomplete
}

// PrimaryEmailPresent reports whether the party's primary guest has a non-blank
// email. A party with no primary guest (e.g. its primary was deleted) reports
// false, which naturally makes its status incomplete. The guests slice must be
// loaded by the caller.
func PrimaryEmailPresent(guests []*Guest) bool {
	for _, g := range guests {
		if g.IsPrimary {
			return g.Email != nil && strings.TrimSpace(*g.Email) != ""
		}
	}
	return false
}

// RequiredAddressPresent reports whether a party carries a full mailing address.
// address_line_2 is optional; every other address field must be non-blank. This
// is only meaningful for physical parties but is computed uniformly.
func RequiredAddressPresent(p *Party) bool {
	return nonBlank(p.AddressLine1) &&
		nonBlank(p.City) &&
		nonBlank(p.StateOrProvince) &&
		nonBlank(p.PostalCode) &&
		nonBlank(p.Country)
}

// StatusOf is the convenience entry point that computes both presence booleans
// from a loaded party (with its guests) and returns the derived status. It is
// the form most call sites want; the lower-level Status exists so the rules can
// be unit-tested without constructing guest rows.
func StatusOf(p *Party) string {
	return Status(p, PrimaryEmailPresent(p.Guests), RequiredAddressPresent(p))
}

// RequiredFieldsPresentFor computes the completion gate for a loaded party,
// deriving the presence booleans from its guests and address. Used by the
// mark-complete gate and the info-form submission.
func RequiredFieldsPresentFor(p *Party) bool {
	return RequiredFieldsPresent(p.InvitationType, PrimaryEmailPresent(p.Guests), RequiredAddressPresent(p))
}

// nonBlank reports whether a nullable string is present and not just whitespace.
func nonBlank(s *string) bool {
	return s != nil && strings.TrimSpace(*s) != ""
}
