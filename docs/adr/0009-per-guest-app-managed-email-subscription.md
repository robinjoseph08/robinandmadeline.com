# Per-guest, app-managed email subscription

Email subscription is a per-Guest boolean (`guests.subscribed`, default true), with unsubscribe state held in our own database rather than Mailgun's suppression list. The unsubscribe link in every email footer is authenticated by the guest's own UUID (`/u/{guestID}`), not a dedicated token like the `info_token` or `rsvp_code` (ADR 0003). We set the `List-Unsubscribe` and `List-Unsubscribe-Post` headers ourselves and leave Mailgun's unsubscribe tracking off.

Subscription is per-Guest because every contact attribute already is (email, phone, and RSVP are guest-level; the info form collects one email per guest), so address-keyed state could not be reflected in the per-guest form checkbox or honored by recipient gating. The guest UUID works as the unsubscribe credential because the action's worst case is a one-click-recoverable unsubscribe: a 122-bit random UUID is unguessable, and being the guest's stable identity, links in already-sent emails never break.

## Considered Options

- **Per-email-address suppression (our own list, or Mailgun's):** rejected; the whole data model is guest-centric, and address-keyed state lives where the form checkbox and recipient gating cannot see it (in Mailgun's case, in another system entirely).
- **A dedicated per-guest unsubscribe token (like `info_token`):** rejected; it buys no meaningful security over a 122-bit UUID for an action this low-stakes, costs a migration plus a backfill, and would break old links if ever regenerated.
- **HMAC-signed guest ID:** rejected; adds crypto and a rotatable secret (rotation breaks old links) for no real security gain at this threat level.

## Consequences

- The guest UUID appears in URLs. This is safe because a bare guest ID grants no capability elsewhere: the guest-facing flows authenticate by the party's info token or RSVP code and resolve guests only within the authenticated party.
- A shared inbox receives one copy per subscribed guest, and unsubscribing one guest does not silence the others. The landing page shows the guest's name so the person knows the action affects only them.
- Subscription is enforced twice: unsubscribed guests are excluded at enqueue (and shown in the compose preview's "unsubscribed" bucket), and the worker re-checks the guest before each send. Because a full send spans two days at the 100/day cap (ADR 0004), a mid-send unsubscribe is routine, so a worker-skipped row is recorded with a dedicated `unsubscribed` recipient status to keep it distinct from a delivery `failed`.
