package parties

import (
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/sortspec"
	"github.com/stretchr/testify/assert"
)

// TestPartySortFieldsHaveExpr and its guest sibling pin the seam between the
// sortspec whitelist and the ORDER BY mapping: every field the binder accepts for
// an entity must map to a real expression, otherwise sorting by it would be a
// silent no-op (the mapper skips an unmapped field). A new whitelisted field
// without an SQL case fails here.
func TestPartySortFieldsHaveExpr(t *testing.T) {
	for _, f := range sortspec.PartyFields() {
		assert.NotEmpty(t, partySortExpr(f), "party sort field %q has no ORDER BY expression", f)
	}
}

func TestGuestSortFieldsHaveExpr(t *testing.T) {
	for _, f := range sortspec.GuestFields() {
		assert.NotEmpty(t, guestSortExpr(f), "guest sort field %q has no ORDER BY expression", f)
	}
}
