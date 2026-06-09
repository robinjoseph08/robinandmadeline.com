# E2E conventions (e2e/)

Playwright end-to-end tests that drive the real admin SPA against a real API and
Postgres. They cover the critical flows from the issue tracker (today: issue #4's
party and guest management). Unit-level behavior stays in Go tests and vitest;
e2e is for whole-journey coverage through the browser.

## Running

- `mise e2e` (or `mise e2e:chromium`) runs them. It first runs `mise e2e:setup`,
  which creates and migrates the dedicated `robinandmadeline_e2e` database (the
  API does not migrate at startup, per ADR 0007), then Playwright builds and boots
  the API and Vite and runs the specs.
- Needs local Postgres up (`docker compose up -d`). The dev server does not need
  to be running; Playwright starts its own on dedicated ports (API 8500, web
  8501) so an e2e run never collides with `mise start` on 8400/8401. Do not run
  `mise e2e` and `mise start` at the same time, though: the e2e API still writes
  the shared `tmp/api.port`, so the dev Vite proxy could momentarily target the
  e2e API.
- CI runs the same thing in a dedicated `e2e` job (its own Postgres service); see
  `.github/workflows/ci.yml`. `mise check:quiet` does not run e2e.

## How the harness works

- `playwright.config.ts` (repo root) starts two webServers per run: the API
  (`go build ... && exec ...`, so the binary is the process-group leader
  Playwright reaps on teardown) pointed at the e2e database, and the Vite dev
  server with `API_PORT` set so its `/api` proxy targets that API. The e2e
  database URL never falls back to the shell's `DATABASE_URL`, so a run can never
  touch dev data.
- Only Chromium runs today. To add Firefox, give each browser its own database
  first (the current single shared database assumes serial, one-browser runs).

## Conventions

- Import `test` / `expect` from `@playwright/test`. Authenticate with
  `loginAsAdmin(page)` from `./auth`, which logs in through the real endpoint and
  seeds the `admin_token` into localStorage before the app boots.
- No test-only API endpoints and no database reset between runs. Instead, name
  every entity with a per-run unique suffix and scope all assertions to those
  names, so a spec is robust against data left by earlier runs in the shared e2e
  database. Use the guest search box to isolate a single row before acting on it.
- Prefer role-based selectors (`getByRole`, `getByLabel`); pass `exact: true`
  when a name is a prefix of another (for example the cell label "Name" versus
  "New guest name"). The grid cells are inputs, so match a row by a cell's
  `inputValue()` (see `partyRow` in `guest-management.spec.ts`), not by row text.
- The delete buttons use `window.confirm`; accept it with a
  `page.on("dialog", (d) => d.accept())` handler. The add row stays open after a
  create (for rapid entry), so reuse it rather than reopening it.
