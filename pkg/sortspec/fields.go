package sortspec

import "github.com/pkg/errors"

// Sortable field tokens shared by the admin lists. They are the wire vocabulary
// of a spec (the part before each ":"), kept in sync with SORT_FIELDS in
// app/libraries/sortSpec.ts and with the ORDER BY mapping in
// pkg/parties/service_list.go. A field is not necessarily valid for every
// entity: PartyFields and GuestFields below list which apply where (e.g. party
// is guest-only, invitation is party-only).
const (
	FieldName       = "name"       // party name / guest full name
	FieldDateAdded  = "date_added" // created_at
	FieldSide       = "side"       // robin / madeline
	FieldRelation   = "relation"   // family / friend
	FieldInvitation = "invitation" // physical / digital (parties only)
	FieldParty      = "party"      // owning party's name (guests only)
)

// Entity discriminators for ValidateSpec, matching the `sortspec=` validator
// param on the query structs (ListPartiesQuery.Sort, ListGuestsQuery.Sort).
// Plural so they never collide with the singular FieldParty token.
const (
	EntityParties = "parties"
	EntityGuests  = "guests"
)

// PartyFields and GuestFields are the sortable fields per entity, in UI display
// order (the frontend renders the add-field buttons in this order). Each entity
// keeps its own list because the sortable columns differ.
func PartyFields() []string {
	return []string{FieldName, FieldDateAdded, FieldSide, FieldRelation, FieldInvitation}
}

func GuestFields() []string {
	return []string{FieldName, FieldParty, FieldDateAdded, FieldSide, FieldRelation}
}

func isPartyField(f string) bool {
	switch f {
	case FieldName, FieldDateAdded, FieldSide, FieldRelation, FieldInvitation:
		return true
	}
	return false
}

func isGuestField(f string) bool {
	switch f {
	case FieldName, FieldParty, FieldDateAdded, FieldSide, FieldRelation:
		return true
	}
	return false
}

// Builtin is the fallback sort applied when neither an explicit sort nor a saved
// default is in play: creation order, oldest first, which is the order the lists
// used before sorting existed. The frontend mirrors this as BUILTIN_*_SORT in
// options.ts; keep them in sync. Returns a fresh slice so callers may mutate it.
func Builtin() []SortLevel {
	return []SortLevel{{Field: FieldDateAdded, Direction: DirAsc}}
}

// ValidateSpec checks that s is a valid sort spec for the given entity. It is the
// hook the binder's sortspec validator calls, so an invalid ?sort= is a 422
// before any handler runs. An empty spec is valid (it means "use the default").
func ValidateSpec(entity, s string) error {
	if s == "" {
		return nil
	}
	switch entity {
	case EntityParties:
		_, err := Parse(s, isPartyField)
		return err
	case EntityGuests:
		_, err := Parse(s, isGuestField)
		return err
	default:
		return errors.Errorf("unknown sort entity %q", entity)
	}
}

// ResolveParties turns a (binder-validated) party sort spec into levels, falling
// back to Builtin for an empty or somehow-invalid spec. It is total (never
// errors) so the service can apply it directly; HTTP requests are already
// validated by the binder, and a direct service caller passing junk just gets
// the default rather than a broken ORDER BY.
func ResolveParties(s string) []SortLevel {
	return resolve(s, isPartyField)
}

// ResolveGuests is ResolveParties for the guest list.
func ResolveGuests(s string) []SortLevel {
	return resolve(s, isGuestField)
}

func resolve(s string, isValidField func(string) bool) []SortLevel {
	if s == "" {
		return Builtin()
	}
	levels, err := Parse(s, isValidField)
	if err != nil || len(levels) == 0 {
		return Builtin()
	}
	return levels
}
