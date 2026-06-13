## Git Conventions

### Commit Message Format

Each commit should be in the format of `[{Category}] {Change description}`

**Categories** (used for changelog generation):
- `[Frontend]`, `[Backend]`, `[Feature]`, `[Feat]` → Features section
- `[Fix]` → Bug Fixes section
- `[Docs]`, `[Doc]` → Documentation section
- `[Test]`, `[E2E]` → Testing section
- `[CI]`, `[CD]` → CI/CD section
- Any other category → Other section

**Examples:**
```
[Frontend] Add dark mode toggle to settings page
[Backend] Add batch delete endpoint for books
[Fix] Resolve race condition in job worker
[E2E] Add tests for user authentication flow
[CI] Add release automation with GitHub Actions
```

## Code conventions

- **API types**: Go is the single source of truth. Every API request and response is a named Go struct in a package's `types.go`; tygo generates the TypeScript the frontend imports. See ADR 0008 and `pkg/CLAUDE.md` / `app/CLAUDE.md`.
- **Errors**: the backend returns `pkg/errcodes` constructors wrapped with `github.com/pkg/errors`; a single handler renders the `{ error: { code, message, status_code } }` envelope. See `pkg/CLAUDE.md`.
- **Migrations**: run via the Fly release_command in production and `mise db:migrate` locally, not at server startup. See ADR 0007.
- **Worktrees**: the dev setup isolates concurrent git worktrees automatically. Each linked worktree gets its own dev and test databases (`pkg/worktree` derives the name; the main checkout keeps the canonical `robinandmadeline`), and `mise start` binds a free port if its preferred one is taken. A new worktree's database starts empty: seed it with `mise db:clone`. So a worktree showing no guest data is expected, not a bug.

## Agent skills

### Issue tracker

Issues and PRDs live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, each mapped to a label string of the same name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
