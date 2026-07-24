---
status: accepted
---

# Activate Neon only on demand for persistent data

This decision is accepted and is being implemented incrementally. The demand-driven email lifecycle, database-free application startup and liveness, conservative connection pool, first-connection attribution, request classification, and API database-work budget are implemented. The independent Info Collection metadata timeout has not landed yet. A Fly machine can start for arbitrary scanner traffic even when the requested response needs no persistent data. Neon compute is therefore activated only by operations whose correct response requires Postgres; process startup, liveness checks, static pages and assets, redirects, unknown routes, and authentication rejection that can be decided from request data or in-memory configuration must not connect. Guest login remains database-backed because rejecting an unknown RSVP Code requires a Party lookup.

## Considered Options

- **Ping Postgres at startup and from Fly health checks**: rejected because every Fly wake activates Neon and recurring health checks keep it active without affecting routing; the existing health endpoint returns 200 even when the database is down.
- **Cache Events in process memory or hard-code the schedule**: deferred. A process cache does not survive Fly scale-to-zero, and Events remain mutable, party-specific, and tied to Event RSVPs. First remove unconditional activation and measure the result.
- **Proxy traffic through Cloudflare**: deferred. Proxying alone does not keep uncached requests from reaching Fly, and it introduces TLS, cache-isolation, and client-IP trust concerns. Cloudflare remains DNS-only.

## Consequences

- `/api/health` reports process liveness only and never checks Postgres. There is no separately polled database health endpoint.
- Database-backed request work gets a five-second database budget. If Postgres cannot be reached in that time, API routes return 503 while database-free pages continue to work.
- The production SQL pool allows at most five open connections, retains at most one idle connection, and closes an idle connection after one minute rather than relying on Go's defaults.
- Unknown document paths return real server-side 404 responses. The server uses an allowlist of React route shapes rather than a denylist of scanner paths such as `*.php`; that allowlist must stay synchronized with the frontend router. It mirrors React Router's case and trailing-slash behavior, rejects malformed or encoded-separator paths safely, and treats dynamic segments as route-shape matches rather than semantic ID validation. Code comments at the allowlist explain this synchronization boundary.
- Static `robots.txt` and `sitemap.xml` files guide cooperative crawlers toward public routes and away from admin, tokenized, and intermediate guest-flow routes. They are crawl hygiene, not access controls.
- Info Collection metadata is the one intentional database-backed shell render. Once its independent timeout lands, a normal GET for a single 30-character lowercase-alphanumeric `/i/:token` path may spend at most one second resolving the Primary Guest's name; malformed paths, HEAD requests, timeouts, and database errors will use the generic title without querying further or failing the document response.
- Enqueueing starts the email worker, which does not poll at process startup or after no immediately actionable recipients remain. The enqueue and idle transition are synchronized so new actionable work cannot be left without an active worker. Recipients blocked by the daily quota, non-stale `sending` rows, interrupted work, and work left after a terminal database error stay durable; later email-admin activity starts reconciliation, so recovery can be delayed until the couple returns to email administration.
- Public and authenticated schedules remain database-backed for now. Schedule hard-coding and in-memory caching will be reconsidered only if Neon usage remains high after these changes.
- The first physical database connection attempt in each process emits one attributed event so Neon activations can be traced to the triggering operation and reviewed after deployment.

## Implementation verification

- Production-assembly tests use an instrumented connector to prove that startup, health checks, static requests, redirects, unknown routes, pre-database authentication rejection, and malformed or HEAD Info Collection requests make zero connection attempts.
- A blocking connector proves the five-second API budget, 503 behavior, and continued availability of database-free routes. The pending metadata-timeout work will add equivalent coverage for its one-second fallback.
- Database-constructor tests pin the open, idle, and idle-lifetime pool settings.
- Route tests cover every frontend route shape plus unknown, case, trailing-slash, malformed-escape, and encoded-separator paths. Crawl-file tests pin the public sitemap inventory and exclusion of admin, tokenized, and intermediate guest-flow routes.
- Worker lifecycle tests cover every enqueue path, enqueue racing with idle transition, quota-blocked recipients, non-stale and stale `sending` rows, transient failures, no startup or idle polling, and later email-admin reconciliation.
- A schedule freshness test changes an Event between requests and observes the committed change. An observability test proves the first-use event occurs exactly once, only at the first physical connection attempt, with its trigger attributed.
