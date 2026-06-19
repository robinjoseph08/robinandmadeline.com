package sortspec_test

import (
	"fmt"
	"strings"
	"testing"

	"github.com/robinjoseph08/robinandmadeline.com/pkg/sortspec"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// anyField accepts every token, so Parse tests exercise the grammar rules
// independent of any entity whitelist.
func anyField(string) bool { return true }

func TestParse_Valid(t *testing.T) {
	t.Run("single level", func(t *testing.T) {
		levels, err := sortspec.Parse("name:asc", anyField)
		require.NoError(t, err)
		assert.Equal(t, []sortspec.SortLevel{{Field: "name", Direction: sortspec.DirAsc}}, levels)
	})
	t.Run("multi level keeps order", func(t *testing.T) {
		levels, err := sortspec.Parse("side:asc,name:desc", anyField)
		require.NoError(t, err)
		assert.Equal(t, []sortspec.SortLevel{
			{Field: "side", Direction: sortspec.DirAsc},
			{Field: "name", Direction: sortspec.DirDesc},
		}, levels)
	})
	t.Run("exactly MaxLevels is accepted", func(t *testing.T) {
		// Pin the upper boundary: MaxLevels distinct fields parse, while one more is
		// rejected (TestParse_Invalid "too many levels"). Catches a > vs >= slip.
		valid := func(f string) bool { return strings.HasPrefix(f, "f") }
		parts := make([]string, sortspec.MaxLevels)
		for i := range parts {
			parts[i] = fmt.Sprintf("f%d:asc", i)
		}
		levels, err := sortspec.Parse(strings.Join(parts, ","), valid)
		require.NoError(t, err)
		assert.Len(t, levels, sortspec.MaxLevels)
	})
}

func TestParse_Invalid(t *testing.T) {
	cases := map[string]string{
		"empty":           "",
		"whitespace":      "name:asc, side:asc",
		"missing colon":   "name",
		"empty direction": "name:",
		"bad direction":   "name:sideways",
		"trailing junk":   "name:asc:extra",
		"empty pair":      "name:asc,,side:asc",
		"duplicate field": "name:asc,name:desc",
		"unknown field":   "bogus:asc",
		"too many levels": "a:asc,b:asc,c:asc,d:asc,e:asc,f:asc,g:asc,h:asc,i:asc",
	}
	// Accept a-i plus name/side so only the rule under test trips each case.
	valid := func(f string) bool {
		switch f {
		case "name", "side", "a", "b", "c", "d", "e", "f", "g", "h", "i":
			return true
		}
		return false
	}
	for name, spec := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := sortspec.Parse(spec, valid)
			assert.Error(t, err, "spec %q should be rejected", spec)
		})
	}
}

func TestSerialize_RoundTrips(t *testing.T) {
	spec := "side:asc,name:desc"
	levels, err := sortspec.Parse(spec, anyField)
	require.NoError(t, err)
	assert.Equal(t, spec, sortspec.Serialize(levels))
	assert.Empty(t, sortspec.Serialize(nil), "empty levels serialize to empty string")
}

func TestValidateSpec_PerEntity(t *testing.T) {
	t.Run("empty is valid for any entity", func(t *testing.T) {
		assert.NoError(t, sortspec.ValidateSpec(sortspec.EntityParties, ""))
		assert.NoError(t, sortspec.ValidateSpec(sortspec.EntityGuests, ""))
	})
	t.Run("invitation is a party field only", func(t *testing.T) {
		require.NoError(t, sortspec.ValidateSpec(sortspec.EntityParties, "invitation:asc"))
		assert.Error(t, sortspec.ValidateSpec(sortspec.EntityGuests, "invitation:asc"))
	})
	t.Run("party is a guest field only", func(t *testing.T) {
		require.NoError(t, sortspec.ValidateSpec(sortspec.EntityGuests, "party:asc"))
		assert.Error(t, sortspec.ValidateSpec(sortspec.EntityParties, "party:asc"))
	})
	t.Run("name is shared", func(t *testing.T) {
		assert.NoError(t, sortspec.ValidateSpec(sortspec.EntityParties, "name:asc"))
		assert.NoError(t, sortspec.ValidateSpec(sortspec.EntityGuests, "name:asc"))
	})
	t.Run("unknown entity errors", func(t *testing.T) {
		assert.Error(t, sortspec.ValidateSpec("widgets", "name:asc"))
	})
}

func TestResolve_FallsBackToBuiltin(t *testing.T) {
	builtin := sortspec.Builtin()
	assert.Equal(t, builtin, sortspec.ResolveParties(""), "empty resolves to builtin")
	assert.Equal(t, builtin, sortspec.ResolveParties("bogus:asc"), "invalid resolves to builtin")
	assert.Equal(t, builtin, sortspec.ResolveGuests(""))

	levels := sortspec.ResolveParties("name:desc")
	assert.Equal(t, []sortspec.SortLevel{{Field: "name", Direction: sortspec.DirDesc}}, levels)
}
