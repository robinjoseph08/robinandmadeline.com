// Package worktree identifies the current git worktree so local development and
// tests can give each worktree its own resources (Postgres databases, and so
// on) with zero configuration. Concurrent worktrees otherwise share fixed-named
// databases on the same server and silently pollute one another.
package worktree

import (
	"os"
	"path/filepath"
	"strings"
)

// Slug returns a short, stable identifier for the current linked git worktree,
// or "" for the main checkout or a non-repo checkout (for example a production
// container). It walks up from the working directory to the first .git: a
// directory means the main checkout (slug ""), whereas a linked worktree's .git
// is a FILE reading "gitdir: <main>/.git/worktrees/<name>", from which the slug
// is <name> sanitized to a Postgres identifier fragment.
//
// Detection is filesystem-only, no git subprocess. Walking up (rather than
// checking only the working directory) means it works whether invoked from the
// worktree root (air, mise, `go run`) or a package subdirectory (`go test`).
func Slug() string {
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for {
		gitPath := filepath.Join(dir, ".git")
		if info, statErr := os.Stat(gitPath); statErr == nil {
			if info.IsDir() {
				return ""
			}
			data, readErr := os.ReadFile(gitPath)
			if readErr != nil {
				return ""
			}
			return slugFromGitdirLine(strings.TrimSpace(string(data)))
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// slugFromGitdirLine parses the "gitdir: <path>" line of a linked worktree's
// .git file and returns a sanitized slug from the worktree name (the final path
// segment), or "" when the line is not a worktree gitdir pointer.
func slugFromGitdirLine(line string) string {
	const prefix = "gitdir: "
	if !strings.HasPrefix(line, prefix) {
		return ""
	}
	gitdir := strings.TrimPrefix(line, prefix)
	// Only a pointer into .git/worktrees/<name> is a worktree; anything else (for
	// example a submodule's .git/modules/<name>) keeps the canonical name.
	if !strings.Contains(filepath.ToSlash(gitdir), "/worktrees/") {
		return ""
	}
	return sanitizeSlug(filepath.Base(gitdir))
}

// sanitizeSlug lowercases s and replaces every character outside [a-z0-9_] with
// "_", yielding a safe Postgres identifier fragment, capped so a prefixed or
// suffixed database name stays within Postgres's 63-byte identifier limit.
func sanitizeSlug(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_':
			b.WriteRune(r)
		default:
			b.WriteRune('_')
		}
	}
	const maxLen = 40
	out := b.String()
	if len(out) > maxLen {
		out = out[:maxLen]
	}
	return out
}
