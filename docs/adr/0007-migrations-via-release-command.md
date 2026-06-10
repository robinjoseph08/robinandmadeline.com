# Run migrations via Fly release_command, not at server startup

Database migrations run as a Fly `release_command` (`cmd/migrations migrate`) during each deploy, not in process when the API boots. The server assumes its schema is already current.

This fits scale-to-zero on Fly (ADR 0001). Machines stop when idle and start on demand, and a deploy is a distinct phase from a machine start, so the deploy is the natural and only place migrations should run.

## Considered Options

- **Migrate at server startup** (`BringUpToDate` in `cmd/api`): rejected. A failed migration is fatal at boot, so on a scale-to-zero machine a bad migration takes the live site down and Fly retries it into a crash loop instead of failing the deploy. Because machines start and stop constantly, every cold start would re-run the migrator (a database round-trip that also wakes Neon), and if Fly ever auto-starts more than one machine they can race on the same migration.
- **Fly `release_command`** (chosen): it runs once per deploy in a temporary machine built from the new image, before any new machine takes traffic. A non-zero exit aborts the deploy and leaves the previous version serving, which is the failure mode we want. It never runs on a machine start, so cold starts stay lean.
- **A manual out-of-band migrate step**: rejected as a footgun. It is easy to forget and is not coupled to the deploy, so the schema and the code can silently diverge.

## Consequences

- The server no longer migrates. `cmd/api` boots against whatever schema exists; provisioning it is the deploy's job.
- Production sets `release_command = "/app/migrations migrate"` in `fly.toml`. That config lands with the deployment work; there is no `fly.toml` yet.
- Local development stays ergonomic: `mise start` depends on `db:migrate`, so a fresh checkout migrates before the servers come up.
- `migrations.BringUpToDate` is still called directly by the test harness, which provisions a throwaway database per run.
- A broken migration blocks the deploy rather than the running site.
