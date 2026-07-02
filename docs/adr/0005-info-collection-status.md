# Info-collection status: derived until requested, gated by required fields

A party's **info-collection status** (`complete`/`incomplete`) is derived from whether its required fields are present, until the couple delegates collection by sending the info link, after which it stays `incomplete` until the guest submits the info form or the couple manually marks it complete. A party can be `complete` only if all required fields are present (a full mailing address for physical parties, with the postal code required only for US addresses since many countries have none; digital parties have no required fields at all), so an under-filled physical party can never be marked complete.

The primary guest's email is deliberately **not** a required field for completion: some older guests have no email, and the couple must still be able to mark their info complete after collecting it offline. It remains required by the info-collection form itself, though (see the consequences), so the two now diverge.

This fits the couple's real workflow: most parties whose details they already know are never collected from, and their status simply tracks whether the data is filled in; parties the couple delegates to must be confirmed by the guest rather than reading as done just because stale data sits on file.

## Considered Options

- **Engagement timestamp only** (`info_submitted_at`, complete once they submit): rejected because parties the couple never sends a link to would sit `incomplete` forever.
- **Pure data-derivation** (complete iff required fields present, always): rejected because an imported party with stale data would read `complete` without anyone confirming it, with no way to force a re-confirmation.

## Consequences

- Two party attributes are required: whether info collection has been **requested** (the link was sent) and the **status** itself. Status is not a single stored boolean; it is derived for not-yet-requested parties and affirmed for requested ones.
- Sending the link always resets status to `incomplete`, and editing fields by hand never changes status once collection has been requested.
- The "required fields" set is invitation-type-specific and is the single gate on completion: a physical party's full mailing address (postal code only for US addresses), and nothing at all for a digital party.
- The info-collection form enforces those fields **plus one the completion gate does not**: the primary guest's email. A guest able to fill in the form can be expected to have an email, so the form insists on it (a submit that clears it is a 422), while the couple can still mark an email-less party complete by hand or via the admin action, having collected that guest's details offline. This is the one place the form's required fields and the completion gate deliberately differ.
- Because email was a digital party's only required field, a digital party now has no required fields, so before its link is sent it derives `complete` outright. That is intended: there is nothing to collect from it up front, and sending the link still resets it to `incomplete` until confirmed.
- "I don't want this party anymore" is handled by deleting the party, not by marking it complete.
