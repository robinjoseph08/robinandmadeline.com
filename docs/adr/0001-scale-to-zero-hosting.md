# Scale-to-zero hosting on Fly.io and Neon

The site must stay online indefinitely as a keepsake at near-zero cost, but traffic is very low and bursty. We deploy the Go binary (which also serves the built React SPA) on Fly.io with auto-stop/auto-start machines, backed by Neon serverless Postgres, both of which scale to zero when idle.

## Considered Options

- **Fly.io vs Google Cloud Run** — chose Fly for operational familiarity (already used for other projects) and a simpler mental model.
- **Neon vs CockroachDB** — chose Neon because we want a true Postgres experience (full wire compatibility, extensions, pg_dump), not a Postgres-compatible distributed database solving scale problems we don't have.
- **Always-on VPS** — rejected; ~$5+/mo indefinitely for a site visited a handful of times a month.

## Consequences

Because the container scales to zero, admin and guest auth use stateless JWTs rather than server-side sessions — there is no session store to lose on shutdown, and tokens validate with just the signing secret. Cold starts are acceptable because Go boots in milliseconds.
