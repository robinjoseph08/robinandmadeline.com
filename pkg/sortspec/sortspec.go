// Package sortspec parses, validates, and serializes multi-level sort
// specifications for the admin list endpoints (e.g. "side:asc,name:asc"). The
// grammar is deliberately self-contained (no DB, no HTTP): the binder validates
// a spec at bind time (see the sortspec validator in pkg/binder), the parties
// service turns a spec into ORDER BY clauses, and the React frontend mirrors the
// same grammar in app/libraries/sortSpec.ts. Which fields are sortable is a
// per-entity concern kept in fields.go.
package sortspec

import (
	"fmt"
	"strings"

	"github.com/pkg/errors"
)

// Direction is "asc" or "desc".
type Direction string

const (
	DirAsc  Direction = "asc"
	DirDesc Direction = "desc"
)

// MaxLevels is the hard cap on how many levels a spec may contain. It bounds the
// ORDER BY a single request can build; the admin lists have only a handful of
// sortable fields, so the cap is never reached in practice and exists to reject
// pathological input. Keep in sync with MAX_SORT_LEVELS in app/libraries/sortSpec.ts.
const MaxLevels = 8

// SortLevel is one field+direction pair in a spec. Field is one of the tokens in
// fields.go; the caller (Parse) has already checked it against the entity whitelist.
type SortLevel struct {
	Field     string
	Direction Direction
}

// Parse reads a serialized spec string (e.g. "side:asc,name:desc") into a slice
// of SortLevel, validating each field with isValidField. It rejects unknown
// fields, bad directions, duplicates, empty pairs, stray whitespace, and specs
// longer than MaxLevels. An empty string is an error (callers that treat "no
// sort" as valid check for "" before calling, e.g. ResolveParties).
//
// Mirrors parseSortSpec in app/libraries/sortSpec.ts (which returns null where
// this returns an error). Keep the two grammars in sync.
func Parse(s string, isValidField func(string) bool) ([]SortLevel, error) {
	if s == "" {
		return nil, errors.New("sort spec is empty")
	}
	// Whitespace is not allowed anywhere: this is a machine-readable URL param,
	// not human prose. Rejecting early keeps the grammar strict.
	if strings.ContainsAny(s, " \t\n\r") {
		return nil, errors.New("sort spec must not contain whitespace")
	}

	parts := strings.Split(s, ",")
	if len(parts) > MaxLevels {
		return nil, errors.Errorf("sort spec has %d levels, max is %d", len(parts), MaxLevels)
	}

	seen := make(map[string]struct{}, len(parts))
	levels := make([]SortLevel, 0, len(parts))

	for _, part := range parts {
		if part == "" {
			return nil, errors.New("sort spec contains an empty pair")
		}

		// SplitN with n=2 plus the length check rejects trailing junk like
		// "name:asc:extra" instead of silently dropping it.
		kv := strings.SplitN(part, ":", 2)
		if len(kv) != 2 {
			return nil, errors.Errorf("sort level %q missing direction", part)
		}

		field, dir := kv[0], kv[1]
		if !isValidField(field) {
			return nil, errors.Errorf("unknown sort field %q", field)
		}
		if dir != string(DirAsc) && dir != string(DirDesc) {
			return nil, errors.Errorf("invalid direction %q (want asc or desc)", dir)
		}
		if _, dup := seen[field]; dup {
			return nil, errors.Errorf("duplicate sort field %q", field)
		}
		seen[field] = struct{}{}

		levels = append(levels, SortLevel{Field: field, Direction: Direction(dir)})
	}

	return levels, nil
}

// Serialize renders a level slice back into the URL-param form. The zero/nil
// slice serializes to the empty string.
func Serialize(levels []SortLevel) string {
	if len(levels) == 0 {
		return ""
	}
	parts := make([]string, len(levels))
	for i, l := range levels {
		parts[i] = fmt.Sprintf("%s:%s", l.Field, l.Direction)
	}
	return strings.Join(parts, ",")
}
