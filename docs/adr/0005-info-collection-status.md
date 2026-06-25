# Info-collection status: derived until requested, gated by required fields

A party's **info-collection status** (`complete`/`incomplete`) is derived from whether its required fields are present, until the couple delegates collection by sending the info link, after which it stays `incomplete` until the guest submits the info form or the couple manually marks it complete. A party can be `complete` only if all required fields are present (the primary guest's email for every party, plus a full mailing address for physical parties, with the postal code required only for US addresses since many countries have none), so an under-filled party can never be marked complete.

This fits the couple's real workflow: most parties whose details they already know are never collected from, and their status simply tracks whether the data is filled in; parties the couple delegates to must be confirmed by the guest rather than reading as done just because stale data sits on file.

## Considered Options

- **Engagement timestamp only** (`info_submitted_at`, complete once they submit): rejected because parties the couple never sends a link to would sit `incomplete` forever.
- **Pure data-derivation** (complete iff required fields present, always): rejected because an imported party with stale data would read `complete` without anyone confirming it, with no way to force a re-confirmation.

## Consequences

- Two party attributes are required: whether info collection has been **requested** (the link was sent) and the **status** itself. Status is not a single stored boolean; it is derived for not-yet-requested parties and affirmed for requested ones.
- Sending the link always resets status to `incomplete`, and editing fields by hand never changes status once collection has been requested.
- The "required fields" set is invitation-type-specific and is the single gate on completion, so the info-collection form must enforce exactly those fields (primary email everywhere; full mailing address for physical parties, with the postal code required only for US addresses).
- "I don't want this party anymore" is handled by deleting the party, not by marking it complete.
