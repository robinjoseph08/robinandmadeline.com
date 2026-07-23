# Database-backed email queue with at-least-once delivery and duplicate suppression

Bulk emails (up to ~174 recipients) are sent through a database-backed queue rather than synchronously in the request handler or via an external queue service. Each `email_recipients` row moves `queued → sending → sent`. Enqueueing starts the worker, which runs until the queue is drained; later email-admin activity restarts it and reconciles stale `sending` rows against the Mailgun API before retrying.

This survives Fly.io scale-to-zero shutdowns without losing emails or sending duplicates, avoids request-handler timeouts on large sends, and does not wake Neon merely because unrelated traffic started the Fly machine. Recovery after an interrupted send can wait until the couple next uses email administration.

## Considered Options

- **Fire-and-forget goroutine**: rejected; progress is lost if the container scales to zero mid-send.
- **External queue (SQS, etc.)**: rejected as overkill for one job type at this scale.

## Consequences

More logic than a goroutine: a demand-started worker loop, an intermediate `sending` state to prevent duplicate pickup, and a Mailgun reconciliation check whenever later email-admin activity resumes interrupted work. Graceful shutdown stops new batches on SIGTERM and finishes the current one. The worker never polls on process startup or after the queue is drained (ADR 0010).
