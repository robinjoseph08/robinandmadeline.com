import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

// Drop the throwaway per-run database and remove the run's scratch files. All
// best-effort: a leaked database or temp dir is not worth failing a green run.
async function globalTeardown(): Promise<void> {
  const databaseUrl = process.env.E2E_RESOLVED_DATABASE_URL;
  if (process.env.E2E_OWNS_DATABASE === "1" && databaseUrl) {
    try {
      execFileSync("go", ["run", "./cmd/migrations", "dropdb"], {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: databaseUrl },
      });
    } catch (err) {
      console.warn("e2e teardown: failed to drop database", err);
    }
  }

  const runId = process.env.E2E_RUN_ID;
  if (runId) {
    fs.rmSync(path.join(os.tmpdir(), `ram-e2e-config-${runId}.json`), {
      force: true,
    });
  }
  if (process.env.E2E_TMP_DIR) {
    fs.rmSync(process.env.E2E_TMP_DIR, { recursive: true, force: true });
  }
}

export default globalTeardown;
