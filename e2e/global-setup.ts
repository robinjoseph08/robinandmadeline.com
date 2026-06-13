import { execFileSync } from "child_process";

// Provision the e2e database before Playwright boots the API. The API does not
// migrate at startup (ADR 0007), so the harness creates and migrates a throwaway
// per-run database here. When the user pinned E2E_DATABASE_URL the run does not
// own the database, so provisioning is left to them.
async function globalSetup(): Promise<void> {
  if (process.env.E2E_OWNS_DATABASE !== "1") {
    return;
  }
  const databaseUrl = process.env.E2E_RESOLVED_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("e2e global setup: resolved database URL is missing");
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl };
  const migrations = (...args: string[]) =>
    execFileSync("go", ["run", "./cmd/migrations", ...args], {
      stdio: "inherit",
      env,
    });

  // Drop first in case a previous run with this id leaked its database, so the
  // suite always starts from a clean, freshly migrated schema.
  migrations("dropdb");
  migrations("createdb");
  migrations("migrate");
}

export default globalSetup;
