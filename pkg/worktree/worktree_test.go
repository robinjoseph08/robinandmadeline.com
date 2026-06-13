package worktree

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

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
