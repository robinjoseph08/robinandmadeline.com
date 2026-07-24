# Database-backed email queue with at-least-once delivery and duplicate suppression

Bulk emails (up to ~174 recipients) are sent through a database-backed queue rather than synchronously in the request handler or via an external queue service. Each `email_recipients` row moves `queued → sending → sent`, and each explicit worker activation checks stale `sending` rows against the Mailgun API before retrying.

This survives Fly.io scale-to-zero shutdowns without losing emails or sending duplicates, and avoids request-handler timeouts on large sends.

## Considered Options

- **Fire-and-forget goroutine**: rejected; progress is lost if the container scales to zero mid-send.
- **External queue (SQS, etc.)**: rejected as overkill for one job type at this scale.

## Consequences

More logic than a goroutine: a worker loop, an intermediate `sending` state to prevent duplicate pickup, and a Mailgun reconciliation check on the next explicit activation after interruption, whether from a committed enqueue or authenticated email-administration activity. Graceful shutdown stops new batches on SIGTERM and finishes the current one.

## Demand-driven lifecycle

ADR 0010 removed startup and idle polling. A committed normal or test-send enqueue wakes the worker and runs it until no immediately actionable recipients remain. Authenticated email-administration API activity also wakes it to reconcile interrupted work. Quota-blocked recipients and non-stale sending rows remain durable without timers, with the accepted trade-off that recovery can wait until the couple returns to email administration.
