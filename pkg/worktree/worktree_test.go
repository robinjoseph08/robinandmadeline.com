package worktree

import (
	"fmt"
	"hash/fnv"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fnv32a8 recomputes the expected tag independently of the code under test, so a
// regression in the format (padding, separator) or the hash (algorithm, hashing
// the base instead of the slug) is caught by the exact-match assertion below.
func fnv32a8(s string) string {
	h := fnv.New32a()
	_, _ = h.Write([]byte(s))
	return fmt.Sprintf("%08x", h.Sum32())
}

func TestScopedName(t *testing.T) {
	const base = "robinandmadeline_test"

	// Empty slug (main checkout / CI) leaves the base name unchanged.
	assert.Equal(t, base, scopedName(base, ""))

	// A non-empty slug appends "_" + a zero-padded 8-hex-digit FNV-32a of the slug.
	got := scopedName(base, "my_feature")
	assert.Equal(t, base+"_"+fnv32a8("my_feature"), got)
	assert.Regexp(t, `^robinandmadeline_test_[0-9a-f]{8}$`, got)

	// Stable across calls, and distinct per slug.
	assert.Equal(t, got, scopedName(base, "my_feature"))
	assert.NotEqual(t, got, scopedName(base, "other"))

	// Stays within Postgres's 63-byte identifier limit, even for the longest base
	// names the codebase uses and a maximal (40-char) slug.
	for _, b := range []string{base, "robinandmadeline_guestimport_test", "robinandmadeline_photogroups_test"} {
		assert.LessOrEqual(t, len(scopedName(b, "a_very_long_worktree_slug_name_indeed_xyz")), 63)
	}
}

func TestSlugFromGitdirLine(t *testing.T) {
	tests := []struct {
		name string
		line string
		want string
	}{
		{"linked worktree", "gitdir: /repo/.git/worktrees/my-feature", "my_feature"},
		{"already-safe name", "gitdir: /repo/.git/worktrees/feature_42", "feature_42"},
		{"submodule is not a worktree", "gitdir: /repo/.git/modules/vendor", ""},
		{"worktrees prefix without a trailing name", "gitdir: /repo/.git/worktrees", ""},
		{"not a gitdir line", "ref: refs/heads/main", ""},
		{"empty", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, slugFromGitdirLine(tt.line))
		})
	}
}

func TestSanitizeSlug(t *testing.T) {
	assert.Equal(t, "my_feature", sanitizeSlug("My-Feature"))
	assert.Equal(t, "a_b_c", sanitizeSlug("a.b/c"))
	assert.Equal(t, "feature_42", sanitizeSlug("feature_42"))
	// Capped so a prefixed/suffixed database name stays within Postgres's limit.
	assert.Len(t, sanitizeSlug(strings.Repeat("x", 60)), 40)
}

func TestSlug(t *testing.T) {
	t.Run("main checkout (.git is a directory) is empty", func(t *testing.T) {
		dir := t.TempDir()
		require.NoError(t, os.Mkdir(filepath.Join(dir, ".git"), 0o755))
		t.Chdir(dir)
		assert.Empty(t, Slug())
	})

	t.Run("linked worktree (.git is a file) yields the slug", func(t *testing.T) {
		dir := t.TempDir()
		require.NoError(t, os.WriteFile(filepath.Join(dir, ".git"),
			[]byte("gitdir: /repo/.git/worktrees/my-feature\n"), 0o600))
		t.Chdir(dir)
		assert.Equal(t, "my_feature", Slug())
	})

	t.Run("walks up from a subdirectory to the worktree root", func(t *testing.T) {
		dir := t.TempDir()
		require.NoError(t, os.WriteFile(filepath.Join(dir, ".git"),
			[]byte("gitdir: /repo/.git/worktrees/nested\n"), 0o600))
		sub := filepath.Join(dir, "pkg", "deep")
		require.NoError(t, os.MkdirAll(sub, 0o755))
		t.Chdir(sub)
		assert.Equal(t, "nested", Slug())
	})
}
