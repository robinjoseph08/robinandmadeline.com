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
```

## Getting started

```sh
# Install pinned tools (go, node, pnpm, air, golangci-lint), dependencies, and
# the Playwright Chromium browser used by the e2e tests
mise setup

# Start local Postgres
docker compose up -d

# Start the API (with hot reload) and the Vite dev server together
mise start
```

The API listens on port `8400` and the Vite dev server runs on `8401`,
proxying `/api/*` to the API.

## Common tasks

| Command            | Description                                       |
| ------------------ | ------------------------------------------------- |
| `mise start`       | Run API (air hot reload) + Vite dev server        |
| `mise start:api`   | Run the API directly (no hot reload)              |
| `mise start:web`   | Run the Vite dev server                           |
| `mise build`       | Build the production API binary                   |
| `mise lint`        | Run golangci-lint                                 |
| `mise lint:js`     | Run ESLint + Prettier + tsc                       |
| `mise test`        | Run Go tests                                      |
| `mise test:unit`   | Run frontend unit tests (Vitest)                  |
| `mise check`       | Run all lint + test checks                        |
| `mise check:quiet` | Run all checks, quiet on success, loud on failure |

## Configuration

Configuration is loaded from environment variables, with local-dev defaults
baked into `pkg/config` so the server runs out of the box. Override any value
by setting its environment variable: `DATABASE_URL`, `PORT`, `ADMIN_USERNAME`,
`ADMIN_PASSWORD`, `JWT_SECRET`.
