# Database-backed email queue with at-least-once delivery

Bulk emails (up to ~174 recipients) are sent through a database-backed queue rather than synchronously in the request handler or via an external queue service. Each `email_recipients` row moves `queued → sending → sent`, and on startup any stale `sending` rows are checked against the Mailgun API before retrying.

This survives Fly.io scale-to-zero shutdowns without losing emails or sending duplicates, and avoids request-handler timeouts on large sends.

## Considered Options

- **Fire-and-forget goroutine**: rejected; progress is lost if the container scales to zero mid-send.
- **External queue (SQS, etc.)**: rejected as overkill for one job type at this scale.

## Consequences

More logic than a goroutine: a worker loop, an intermediate `sending` state to prevent duplicate pickup, and a Mailgun reconciliation check on restart. Graceful shutdown stops new batches on SIGTERM and finishes the current one.
