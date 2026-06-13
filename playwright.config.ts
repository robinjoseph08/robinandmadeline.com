import { randomUUID } from "crypto";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import { defineConfig } from "@playwright/test";

// Dynamic, per-run ports and a dedicated, throwaway per-run database, so several
// e2e runs (from different git worktrees, or e2e alongside `mise start`) never
// collide on a port or share a database. Ports are picked by briefly binding :0
// (the OS hands back a free port); the database is created and migrated by
// ./e2e/global-setup and dropped by ./e2e/global-teardown.

// findAvailablePort briefly binds port 0 so the OS assigns a free port, then
// releases it and returns the number. There is an inherent gap between releasing
// and the server re-binding, but for a handful of runs on a dev box it is more
// than adequate.
function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

interface E2EConfig {
  apiPort: number;
  frontendPort: number;
  databaseUrl: string;
  // Whether this run owns the database (and so should create it on setup and
  // drop it on teardown). False when the user supplied E2E_DATABASE_URL.
  ownsDatabase: boolean;
  tmpDir: string;
}

// Playwright evaluates this config file once in the main process and again in
// every worker process. All evaluations must agree on the same ports, database,
// and temp dir, so the first one allocates them and writes a config file keyed
// by a run id carried in the environment (and thus inherited by workers); later
// evaluations read it back. The run id is a fresh UUID (not the pid) so a
// crashed run that leaks its config file can never be misread by a later run
// that happens to reuse the pid.
async function getOrCreateE2EConfig(): Promise<E2EConfig> {
  const runId = process.env.E2E_RUN_ID || randomUUID().replace(/-/g, "");
  process.env.E2E_RUN_ID = runId;

  const configFile = path.join(os.tmpdir(), `ram-e2e-config-${runId}.json`);
  if (fs.existsSync(configFile)) {
    return JSON.parse(fs.readFileSync(configFile, "utf-8"));
  }

  const [apiPort, frontendPort] = await Promise.all([
    findAvailablePort(),
    findAvailablePort(),
  ]);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `ram-e2e-${runId}-`));

  // The e2e API talks to a dedicated database, never the shell's DATABASE_URL
  // (which may point at dev data). By default each run gets its own throwaway
  // database; set E2E_DATABASE_URL to pin a specific database instead, which the
  // harness then leaves in place. CI uses the default per-run database.
  const override = process.env.E2E_DATABASE_URL;
  const databaseUrl =
    override ??
    `postgres://robinandmadeline_admin:password@localhost:5432/robinandmadeline_e2e_${runId}?sslmode=disable`;

  const config: E2EConfig = {
    apiPort,
    frontendPort,
    databaseUrl,
    ownsDatabase: override === undefined,
    tmpDir,
  };
  fs.writeFileSync(configFile, JSON.stringify(config));
  return config;
}

const e2e = await getOrCreateE2EConfig();

// Hand the resolved values to global setup/teardown, which run in this main
// process after the module is evaluated, without re-deriving them.
process.env.E2E_RESOLVED_DATABASE_URL = e2e.databaseUrl;
process.env.E2E_OWNS_DATABASE = e2e.ownsDatabase ? "1" : "0";
process.env.E2E_TMP_DIR = e2e.tmpDir;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  // One worker so specs run serially against the single per-run database,
  // avoiding cross-file races. To add a second browser, give it its own database
  // first (so the two do not share state).
  workers: 1,
  // Provision/drop the throwaway database around the run (the API does not
  // migrate at startup, per ADR 0007).
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${e2e.frontendPort}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      // Build, then `exec` the binary so it IS the process-group leader
      // Playwright tracks: on teardown Playwright SIGKILLs the whole group, and
      // routing through `go run` (orphans the child binary) or `mise` (separate
      // process group) would leave the API alive and hang the run.
      command:
        "go build -o ./build/api/api-e2e ./cmd/api && exec ./build/api/api-e2e",
      url: `http://localhost:${e2e.apiPort}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(e2e.apiPort),
        DATABASE_URL: e2e.databaseUrl,
        JWT_SECRET: "e2e-test-secret",
        // Admin auth is config-based; pin the dev defaults so the spec's login is
        // deterministic regardless of the surrounding shell environment.
        ADMIN_USERNAME: "admin",
        ADMIN_PASSWORD: "changeme",
        // The per-IP login rate limiter (ADR 0006) would throttle a retried run
        // (every spec's logins come from localhost); raise it well past anything
        // the specs can hit. The limiter's own behavior is covered by Go tests
        // in pkg/auth.
        LOGIN_RATE_PER_MINUTE: "600",
        LOGIN_RATE_BURST: "100",
        // Keep the e2e API off the dev server's tmp/api.port so a run never
        // hijacks a running `mise start` Vite proxy.
        API_PORT_FILE: path.join(e2e.tmpDir, "api.port"),
      },
    },
    {
      command: `pnpm exec vite --port ${e2e.frontendPort} --strictPort`,
      url: `http://localhost:${e2e.frontendPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        API_PORT: String(e2e.apiPort),
        // Isolated Vite cache so a run does not corrupt the dev server's (or a
        // concurrent run's) dependency pre-bundle when several Vites run from
        // this same project directory.
        VITE_CACHE_DIR: path.join(e2e.tmpDir, "vite-cache"),
      },
    },
  ],
});
