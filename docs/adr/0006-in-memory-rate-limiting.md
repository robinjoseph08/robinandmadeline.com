# In-memory rate limiting despite scale-to-zero

Both login endpoints (`/api/auth/guest/login` and `/api/auth/admin/login`) are protected by a per-IP, short-window rate limiter held in process memory (Echo's `RateLimiterMemoryStore`). This runs against the grain of scale-to-zero (ADR 0001) and of the precedent set by the database-backed email queue (ADR 0004), which keeps shutdown-surviving state in Postgres.

Short-window rate-limit state is ephemeral by nature, so the scale-to-zero tension does not actually bite: during an active brute-force the container stays warm under the attacker's continuous traffic, so the counters persist for the life of the attack; when the container scales to zero there is no traffic and therefore no attack, so losing the counters is harmless; and a cold start resets counters no more generously than the short window already does. Durable storage would only matter for a long horizon (e.g. a daily lockout), which we deliberately avoid because it would punish guests who fumble their memorable RSVP code.

## Consequences

- The rate limiter is the compensating control for the low-entropy, memorable RSVP codes from ADR 0003: keep the codes memorable and defend at the login instead of lengthening them.
- This assumes a single running machine. If the app is ever scaled to multiple machines, per-process counters stop sharing state and the effective limit multiplies by machine count; revisit with a shared store (Postgres or Redis) at that point.
- The client IP must be extracted from Fly's forwarded header via Echo's `IPExtractor`, or every caller collapses into a single bucket and legitimate guests get throttled together.
