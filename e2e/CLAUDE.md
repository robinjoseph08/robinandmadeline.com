# E2E conventions (e2e/)

Playwright end-to-end tests that drive the real SPA against a real API and
Postgres. They cover the critical flows from the issue tracker (today: issue
#4's party and guest management, issue #7's guest RSVP flow, issue #8's
info-collection flow, issue #9's public/personalized schedule, and issue #10's
photo groups). Unit-level behavior stays in Go tests and vitest; e2e is for
whole-journey coverage through the browser.

## Running

- `mise e2e` (or `mise e2e:chromium`) runs them. Playwright's globalSetup creates
  and migrates a throwaway per-run database (the API does not migrate at startup,
  per ADR 0007), then it builds and boots the API and Vite and runs the specs;
  globalTeardown drops that database afterward.
- Needs local Postgres up (`docker compose up -d`). The dev server does not need
  to be running, and an e2e run is safe alongside `mise start` or another
  worktree's e2e run: ports are allocated dynamically per run, the database is
  unique per run, and the e2e API writes a throwaway port file (`API_PORT_FILE`)
  instead of the dev server's `tmp/api.port`.
- CI runs the same thing in a dedicated `e2e` job (its own Postgres service); see
  `.github/workflows/ci.yml`. Locally, both `mise check` and `mise check:quiet`
  run e2e too (as the `e2e:chromium` step).

## How the harness works

- `playwright.config.ts` (repo root) allocates a free API and frontend port per
  run (by briefly binding `:0`) and a per-run database name, sharing them across
  Playwright workers via a run-id-keyed file in the temp dir. It starts two
  webServers: the API (`go build ... && exec ...`, so the binary is the
  process-group leader Playwright reaps on teardown) pointed at that database,
  and the Vite dev server with `API_PORT` set so its `/api` proxy targets that
  API. The e2e database URL never falls back to the shell's `DATABASE_URL`, so a
  run can never touch dev data; set `E2E_DATABASE_URL` to pin a specific database
  (the harness then leaves it in place instead of dropping it).
- `e2e/global-setup.ts` provisions the per-run database (create + migrate) before
  the servers boot; `e2e/global-teardown.ts` drops it and removes the run's temp
  files.
- Only Chromium runs today. To add Firefox, give each browser its own database
  first (the current single per-run database assumes serial, one-browser runs).

## Conventions

- Import `test` / `expect` from `@playwright/test`. Authenticate with
  `loginAsAdmin(page)` from `./auth`, which logs in through the real endpoint and
  seeds the `admin_token` into localStorage before the app boots.
- No test-only API endpoints and no database reset between runs. Instead, name
  every entity with a per-run unique suffix from `runStamp()` in `./stamp` and
  scope all assertions to those names, so a spec is robust against data left by
  earlier runs in the shared e2e database. The stamp is letters-only by design
  (its comment explains why digits would break guest-search isolation). Use the
  guest search box to isolate a single row before acting on it.
- Prefer role-based selectors (`getByRole`, `getByLabel`); pass `exact: true`
  when a name is a prefix of another (for example the cell label "Name" versus
  "New guest name"). The grid cells are inputs, so match a row by a cell's
  `inputValue()` (see `partyRow` in `guest-management.spec.ts`), not by row text.
- The guest grid's delete buttons use `window.confirm`; accept it with a
  `page.on("dialog", (d) => d.accept())` handler. Photo group deletes instead
  open the app's Dialog component, so click its explicit confirm button (see
  `photo-groups.spec.ts`). The add row stays open after a create (for rapid
  entry), so reuse it rather than reopening it.
