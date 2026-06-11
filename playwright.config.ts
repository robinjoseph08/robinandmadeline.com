import { defineConfig } from "@playwright/test";

// Fixed, dedicated e2e ports, distinct from dev's 8400/8401, so an e2e run never
// collides with a running dev server and we never accidentally reuse a dev server
// pointed at the dev database.
const API_PORT = 8500;
const FRONTEND_PORT = 8501;

// The e2e API talks to a dedicated, throwaway database, kept separate from the
// Go-test database (robinandmadeline_test) so the two never interfere. The
// `mise e2e:setup` task creates and migrates it before Playwright starts the
// servers, because the API does not migrate at startup (ADR 0007). Overridable
// via E2E_DATABASE_URL (set in CI); never falls back to the shell's DATABASE_URL,
// which may point at the dev database.
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ??
  "postgres://robinandmadeline_admin:password@localhost:5432/robinandmadeline_e2e?sslmode=disable";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  // One worker so specs run serially against the single shared e2e database,
  // avoiding cross-file races. Only chromium runs today; to add firefox, give
  // each browser its own database first (so the two do not share state).
  workers: 1,
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      // Build, then `exec` the binary so it IS the process-group leader Playwright
      // tracks: on teardown Playwright SIGKILLs the whole group, and routing
      // through `go run` (orphans the child binary) or `mise` (separate process
      // group) would leave the API alive and hang the run.
      command:
        "go build -o ./build/api/api-e2e ./cmd/api && exec ./build/api/api-e2e",
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        DATABASE_URL,
        JWT_SECRET: "e2e-test-secret",
        // Admin auth is config-based; pin the dev defaults so the spec's login is
        // deterministic regardless of the surrounding shell environment.
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "changeme",
        // The per-IP login rate limiter (ADR 0006) would throttle a retried
        // run (every spec's logins come from localhost); raise it well past
        // anything the specs can hit. The limiter's own behavior is covered by
        // Go tests in pkg/auth.
        LOGIN_RATE_PER_MINUTE: "600",
        LOGIN_RATE_BURST: "100",
      },
    },
    {
      command: `pnpm exec vite --port ${FRONTEND_PORT} --strictPort`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        API_PORT: String(API_PORT),
      },
    },
  ],
});
