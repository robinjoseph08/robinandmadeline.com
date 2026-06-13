package databasetest

import (
	"fmt"
	"hash/fnv"
	"testing"

	"github.com/stretchr/testify/assert"
)

// tag is the canonical expected suffix, recomputed independently of the code
// under test, so a regression in the format (padding, separator) or the hash
// (algorithm, hashing base instead of slug) is caught by the exact-match below.
func tag(slug string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(slug))
	return fmt.Sprintf("%08x", h.Sum32())
}

func TestSuffixForSlug(t *testing.T) {
	const base = "robinandmadeline_test"

	// Empty slug (main checkout / CI) leaves the base name unchanged.
	assert.Equal(t, base, suffixForSlug(base, ""))

	// A non-empty slug appends "_" + a zero-padded 8-hex-digit FNV-32a of the slug.
	got := suffixForSlug(base, "my_feature")
	assert.Equal(t, base+"_"+tag("my_feature"), got)
	assert.Regexp(t, `^robinandmadeline_test_[0-9a-f]{8}$`, got)

	// Stable across calls, and distinct per slug.
	assert.Equal(t, got, suffixForSlug(base, "my_feature"))
	assert.NotEqual(t, got, suffixForSlug(base, "other"))

	// Stays within Postgres's 63-byte identifier limit, even for the longest base
	// names the package uses and a maximal (40-char) slug.
	for _, b := range []string{base, "robinandmadeline_guestimport_test", "robinandmadeline_photogroups_test"} {
		assert.LessOrEqual(t, len(suffixForSlug(b, "a_very_long_worktree_slug_name_indeed_xyz")), 63)
	}
}
