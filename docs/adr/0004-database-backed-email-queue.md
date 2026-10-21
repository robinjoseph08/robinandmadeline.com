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

## Failure handling

A send error only fails a recipient when Mailgun gave a definitive, message-specific 4xx. Everything else is handled so that no email is dropped or sent twice:

- A 5xx, timeout, or connection error leaves the recipient `sending` for reconciliation (Mailgun may have accepted it). One is treated as a blip and the batch carries on; two in a row stop the activation, return the rest of its claim to the queue untouched, and pause claims for a minute.
- A failure loading a recipient's send, event, or guest returns it to the queue and stops the activation: nothing was dispatched.
- A 401 or 403 is an account problem (a bad key, a domain not allowed to send): the recipients go back to the queue with an explanation shown on the send detail page, the activation stops, and claims pause for a minute, so a configuration mistake never fails a whole send.
- A quota rejection's pause is saved in `app_settings` until the next UTC midnight, so a scale-to-zero restart the same day does not send into the spent quota again.
- Mailgun's free plan keeps its event log for one day, so a `sending` recipient more than 20 hours old that Mailgun has no record of is marked failed with an explanation rather than requeued: requeueing could send a second copy of an email that went out. This narrows the title's at-least-once guarantee: an interrupted send not reconciled within that window is at-most-once, and it surfaces as a failure for the couple to check rather than a possible duplicate.
- The compose page sends a `request_id` with each send. A retry with the same key returns the original send instead of queueing a duplicate, and reusing a key for different content is a 409.
