# An Event RSVP row is the invitation

We track per-event RSVPs in a single `event_rsvps` table where the existence of a row (with status `pending`) means a guest is invited to that event. There is no separate invitations table. Public events get rows for all guests; private events get rows only for invited parties.

## Considered Options

- **Separate `event_invitations` table**: rejected as an extra layer with no benefit at this scale; "invited" and "responded" are cleanly expressed by one row with a status.

## Consequences

Invitation membership must be kept in sync through application logic: creating a public event back-fills `pending` rows for all guests, and adding a guest back-fills `pending` rows for all public events. Both run in the same transaction as the parent operation.
