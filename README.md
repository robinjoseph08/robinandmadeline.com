# Wedding Website

Robin and Madeline's wedding website. A monorepo with a Go API backend and a
React frontend.

## Stack

- **Backend**: Go + [Echo](https://echo.labstack.com/) + [Bun ORM](https://bun.uptrace.dev/) (Postgres)
- **Frontend**: React 19 + React Router v7 + Vite + Tailwind CSS v4 + shadcn/ui
- **Tooling**: [mise](https://mise.jdx.dev/) (tasks + tool pins), air (Go hot reload), golangci-lint, ESLint, Prettier, Vitest
- **Local infra**: docker-compose (Postgres 17)

## Layout

```
cmd/api/            Go API entry point (main, graceful shutdown)
pkg/config/         Environment-based configuration
pkg/database/       Bun ORM + Postgres setup
pkg/server/         Echo server + routes (GET /api/health)
app/                React frontend (components, pages, router)
docker-compose.yml  Local Postgres
mise.toml           Tool pins + tasks
Dockerfile          Production image (Go binary + built SPA)
fly.toml            Fly.io app config (scale-to-zero, release_command)
```

## Getting started

```sh
# Install pinned tools (go, node, pnpm, air, golangci-lint, tygo) and
# dependencies, generate the TypeScript API types, and install the Playwright
# Chromium browser used by the e2e tests
mise setup

# Start local Postgres
docker compose up -d

# Start the API (with hot reload) and the Vite dev server together
mise start
```

The API listens on port `8400` and the Vite dev server runs on `8401`,
proxying `/api/*` to the API. The Vite dev server discovers the API's actual
port from `tmp/api.port`, so the ports are not load-bearing.

### Worktrees

The dev setup is built to run several git worktrees at once (for parallel
agents). Each worktree self-isolates with no configuration:

- **Database**: the main checkout uses `robinandmadeline`; each linked worktree
  derives its own `robinandmadeline_wt_<name>` (see `pkg/worktree` +
  `pkg/config`), created by `mise db:create` ahead of migrating. Test databases
  are likewise suffixed per worktree (`internal/databasetest`).
- **Ports**: if `8400` is already held by another worktree's API, the next
  `mise start` binds a free port instead and publishes it to `tmp/api.port`;
  Vite (`strictPort: false`) hops to a free port of its own.
- **E2E**: each run gets dynamically allocated ports and a throwaway database.

A new worktree starts with an empty database. Seed it from the main checkout's
data with `mise db:clone` (needs the Postgres client tools: `pg_dump`, `psql`).

## Common tasks

| Command             | Description                                       |
| ------------------- | ------------------------------------------------- |
| `mise start`        | Run API (air hot reload) + Vite dev server        |
| `mise start:api`    | Run the API directly (no hot reload)              |
| `mise start:web`    | Run the Vite dev server                           |
| `mise db:migrate`   | Create (if needed) and migrate this worktree's DB |
| `mise db:clone`     | Seed this worktree's DB from the main checkout    |
| `mise build`        | Build the production API binary                   |
| `mise build:docker` | Build the production Docker image                 |
| `mise lint`         | Run golangci-lint                                 |
| `mise lint:js`      | Run ESLint + Prettier + tsc                       |
| `mise test`         | Run Go tests                                      |
| `mise test:unit`    | Run frontend unit tests (Vitest)                  |
| `mise check`        | Run all lint + test checks                        |
| `mise check:quiet`  | Run all checks, quiet on success, loud on failure |

## Configuration

Configuration is loaded from environment variables, with local-dev defaults
baked into `pkg/config` so the server runs out of the box. Override any value
by setting its environment variable: `DATABASE_URL`, `PORT`, `ADMIN_USERNAME`,
`ADMIN_PASSWORD`, `JWT_SECRET`.

Three settings exist only for production and default off so local dev is
unaffected: `STATIC_DIR` (serve the built SPA from this directory),
`CANONICAL_HOST` (permanently redirect every other host to this one), and
`TRUST_PROXY_HEADERS` (resolve client IPs from Fly's forwarded header).

Email delivery (the admin email system) is configured separately and is off by
default: without `MAILGUN_API_KEY` the queue worker never starts and sends
stay queued. Set `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, and
`MAILGUN_WEBHOOK_SIGNING_KEY` (plus optionally `MAILGUN_BASE_URL`,
`EMAIL_FROM`, `PUBLIC_BASE_URL`, and the `EMAIL_WORKER_*` tuning knobs) to
enable real sending and delivery webhooks. Emails go out as HTML (a Markdown
body rendered into an in-repo, palette-matched shell) with a plaintext
fallback.

`EMAIL_TEST_RECIPIENTS` powers the compose page's "Send test" button only: set
it to a comma-separated list of RFC5322 addresses (for example
`Robin <robin@example.com>, Madeline <madeline@example.com>`) and the button
enqueues the current draft as a real send to those inboxes so the couple can
eyeball it. It is empty by default (the button then 422s), and it is kept in the
environment so personal contact info is never committed. A test send goes
through the same queue and worker as a real send: it is rendered from the first
guest matching the recipient filter (so the merge fields show real copy), counts
against the daily send limit once dispatched, gets delivery status from the
Mailgun webhook, and appears in the send history flagged as a test (where it can
be filtered out). On the free plan each test send consumes one of the 100 daily
sends.

Outbound volume is capped by `EMAIL_DAILY_SEND_LIMIT` (default 100, matching
Mailgun's free plan). The worker counts dispatch attempts per UTC day, which
is Mailgun's own reset boundary, and pauses until the next UTC day once the
budget is spent; queued emails simply wait, so a 200-recipient send on the
default limit drains over two days. Set it to 0 (or any negative value) for
unlimited on a paid plan. The counter only tracks sends made by this app:
manual sends from the Mailgun dashboard are invisible to it, so set a lower
limit for margin if you ever send manually. As a backstop, a send Mailgun
itself rejects for quota is requeued for the next day rather than failed, and
sending pauses for the rest of the UTC day; after a few such rejections of
the same email it is marked failed instead, so a rejection misread as quota
surfaces in the send history within days instead of silently stalling the
queue.

## Deployment

Production is a single Fly.io app (Go binary serving the API and the built
SPA) backed by Neon Postgres, scaling to zero when idle. The site serves from
www.robinandmadeline.com; every other host (the bare apex,
madelineandrobin.com, robeline.co, robeline.com, and www variants)
permanently redirects there. Merging to `master` deploys automatically once
CI passes (bluegreen, so the single machine is replaced with no downtime, and
migrations run via the release command first). `mise build:docker` produces
the production image locally. See [docs/deployment.md](docs/deployment.md) for
the full runbook, including the one-time Fly/Neon/Cloudflare setup.
