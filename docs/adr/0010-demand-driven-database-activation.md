# Activate Neon only on demand for persistent data

A Fly machine can start for arbitrary scanner traffic even when the requested response needs no persistent data. Neon compute is therefore activated only by operations whose correct response requires Postgres; process startup, liveness checks, static pages and assets, redirects, unknown routes, and authentication rejection must not connect to the database.

## Considered Options

- **Ping Postgres at startup and from Fly health checks**: rejected because every Fly wake activates Neon and recurring health checks keep it active without affecting routing; the existing health endpoint returns 200 even when the database is down.
- **Cache Events in process memory or hard-code the schedule**: deferred. A process cache does not survive Fly scale-to-zero, and Events remain mutable, party-specific, and tied to Event RSVPs. First remove unconditional activation and measure the result.
- **Proxy traffic through Cloudflare**: deferred. Proxying alone does not keep uncached requests from reaching Fly, and it introduces TLS, cache-isolation, and client-IP trust concerns. Cloudflare remains DNS-only.

## Consequences

- `/api/health` reports process liveness only and never checks Postgres. There is no separately polled database health endpoint.
- Database-backed routes connect lazily. If Postgres cannot be reached within a bounded attempt, API routes return 503 while database-free pages continue to work.
- The production SQL pool uses conservative open, idle, and idle-lifetime limits rather than Go's unbounded defaults.
- Unknown document paths return real server-side 404 responses. The server uses an allowlist of valid React route shapes rather than a denylist of scanner paths such as `*.php`; that allowlist must stay synchronized with the frontend router.
- Info Collection metadata is the one intentional database-backed shell render. A normal GET for a single 30-character lowercase-alphanumeric `/i/:token` path may resolve the Primary Guest's name; malformed paths and HEAD requests use the generic title without querying.
- The email worker starts after enqueue and runs until the queue is drained. It does not poll at process startup or while no email work is active. If shutdown interrupts a send, later email-admin activity starts reconciliation and resumes it, so recovery can be delayed until the couple returns to email administration.
- Public and authenticated schedules remain database-backed for now. Schedule hard-coding and in-memory caching will be reconsidered only if Neon usage remains high after these changes.
- The first database use in each process is observable so Neon activations can be attributed and reviewed after deployment.
