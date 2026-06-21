# Wedding Website

The domain language for robinandmadeline.com: a custom wedding site that manages the guest list, two-phase guest interaction (info collection then RSVP), the event schedule, photo groups, and email communications.

## Language

**Party**:
A group of guests who receive a single invitation and share one mailing address and one RSVP code. The party's name is an internal label the couple uses to identify groups; it is never shown to guests.
_Avoid_: Household, group, family (a party isn't always a family)

**Guest**:
An individual person belonging to exactly one party.
_Avoid_: Invitee, attendee (attendance isn't known until they RSVP)

**Primary Guest**:
The guest who is the main point of contact for their party.
_Avoid_: Head of household, owner

**Placeholder Guest**:
An unnamed plus-one slot: a guest record that carries Placeholder Text (its permanent descriptor, e.g. "Guest of John Doe"). It is invisible during Info Collection (which covers only the people the couple already knows) and first surfaces in the RSVP flow. Naming it during RSVP sets the guest's name without erasing the descriptor, and the name stays editable until the RSVP deadline so a party can swap who fills the slot, or clear the name to revert the slot to unnamed (the descriptor is what remains). A person whose name is only approximately known is a real guest with a best-guess name (corrected during info collection), not a placeholder.
_Avoid_: Plus-one (the slot, not the person who eventually fills it); any guest whose name is uncertain (that is a real guest with a best-guess name)

**Placeholder Text**:
The permanent descriptor of a Placeholder Guest (e.g. "Guest of John Doe"). A guest is a placeholder exactly when it has Placeholder Text; clearing it turns the record into a regular guest. Naming the slot never erases it.
_Avoid_: Placeholder flag (there is no boolean; the text is the marker)

**Side**:
Whether a party is Robin's or Madeline's. A party-level attribute with exactly one value.
_Avoid_: Kingdom (the spreadsheet's name, not used in the system)

**Relation**:
Whether a party is family or friends. A party-level attribute with exactly one value.
_Avoid_: Phylum

**Circle**:
How the couple knows a party (Immediate, Extended, College, Work, Childhood, Other). A party-level attribute that can hold multiple values.
_Avoid_: Class

**Tags**:
A guest's relationship labels (Sibling, In-Law, Bridal Party, Cousin, UIUC, etc.). A guest-level attribute that can hold multiple values, open-ended rather than a fixed set.
_Avoid_: Order, roles (the PRD's original name for this attribute)

**Event**:
A scheduled wedding activity (Rehearsal Dinner / Madhuram Veppu, Ceremony, Reception, possibly Brunch).

**Location**:
The human-readable label for where an **Event** takes place (e.g., "Garden Pavilion"). Optional and free-form: a display label, not a structured address.

**Location Link**:
An optional couple-provided URL attached to an **Event**'s **Location** that guests click to open the place, typically a Google Maps or directions page. It accepts any http or https URL, so "map" describes its intent, not a restriction on what it may point to.
_Avoid_: Map Link (the field accepts any http(s) URL, not only maps); Location URL (the spoken term is "link", though the stored value is a URL)

**Public Event**:
An event visible on the schedule to anyone, with no code required.

**Private Event**:
An event visible only to guests who are invited to it.

**Madhuram Veppu**:
A traditional ceremony that the Rehearsal Dinner doubles as, drawing a larger group than a typical rehearsal dinner.

**Event RSVP**:
A guest's response to a single event: pending, attending, or not_attending. The existence of an Event RSVP record is what marks a guest as invited to that event.
_Avoid_: RSVP (the unqualified word; there is no single wedding-wide RSVP; attendance is always per-event)

**Info Token**:
A random, opaque per-party token embedded in the pre-invitation info-collection URL.
_Avoid_: Code (guests never see this as a code)

**RSVP Code**:
A memorable, often personalized per-party code (e.g. KALEL, PEPPER) revealed on the printed invitation and used to authenticate the RSVP flow. When the couple does not set a personalized code, a random five-letter code (from an alphabet that avoids confusable letters and cannot spell words) is generated at party creation; a cleared code stays empty until set again.
_Avoid_: Password, info token

**Invitation Type**:
Whether a party receives a physical mailed invitation or a digital-only one.

**Info Collection**:
The pre-invitation phase in which a party confirms its contact details and, for physical parties, its mailing address, and corrects guest details the couple has wrong (e.g. an approximate name). It covers only known guests: Placeholder Guests are invisible until the RSVP flow. The party can also remove a known member who is no longer part of it (an ex, or a child who definitely won't come), though never its Primary Guest.
_Avoid_: Onboarding, signup

**Info Collection Requested**:
A party whose info link has been sent, delegating info gathering to the guest.
_Avoid_: Invited (reserved for events)

**Info Collection Status**:
Whether a party's info collection is complete or incomplete.

**Email Subscription**:
Whether a Guest receives the couple's broadcast email updates. A per-guest attribute with two states, Subscribed and Unsubscribed, that defaults to Subscribed. Because it is per-guest, when two guests share one inbox each controls their own copy independently. Unsubscribing is the act of moving to Unsubscribed; Resubscribing moves back.
_Avoid_: Opt-out (names the action, not the state), Email preferences (implies a multi-toggle settings panel that does not exist), Marketing consent (wrong register for a wedding)

**Photo Group**:
A named set of guests needed together for a specific photo, with a shooting order. All group photos happen in the one session between the ceremony and the reception, so photo groups form a single global list; they are not tied to an event.
_Avoid_: Photo shoot, album (the photo gallery is unrelated); per-event photo groups (there is exactly one photo session)

## Relationships

- A **Party** has one or more **Guests**; exactly one is the **Primary Guest**.
- A **Party** is born with its first **Guest** (who starts as its **Primary Guest**) and never exists empty: deleting the last **Guest** deletes the **Party**.
- When the **Primary Guest** leaves a **Party** (deleted, or moved to another party), the oldest remaining **Guest** is promoted; unsetting the sole primary is refused.
- A **Party** has one **Side**, one **Relation**, and one or more **Circles**.
- A **Guest** has zero or more **Tags**.
- A **Placeholder Guest** carries **Placeholder Text**; the slot is hidden during **Info Collection**, and naming it (during RSVP, until the deadline) never erases the descriptor, so the slot stays identifiable and re-nameable.
- A **Party** has one **Info Token** and one **RSVP Code**.
- A **Guest** has one **Event RSVP** per **Event** they are invited to.
- An **Event** has an optional **Location**, which may carry an optional **Location Link**. A **Location Link** cannot exist without a **Location**: the link decorates the label, so a link with no label is rejected.
- A **Photo Group** contains zero or more **Guests** (it may sit empty while the shot list is drafted, and an empty group still shifts the positions every party sees). Photo groups belong to no **Event**: they form one global shooting order for the single photo session between the ceremony and the reception.
- A **Guest** carries individual email, phone, dietary restrictions, and RSVP responses; the mailing **address** lives on the **Party**.
- A **Guest** has an **Email Subscription** (defaulting to Subscribed) that governs whether broadcast email reaches them; it is independent per guest even when guests share an inbox.
- A **Party** becomes **Info Collection Requested** once its info link is sent; requesting resets its **Info Collection Status** to incomplete.
- A **Party**'s **Info Collection Status** can be complete only when all required fields are present; until collection is requested it is derived from whether those fields are present.
- Overall attendance is derived: a **Guest** is "coming" if they are attending at least one **Event**.

## Example dialogue

> **Dev:** "When a guest enters their RSVP code, are they RSVPing to the wedding?"
> **Couple:** "No, there's no single wedding RSVP. The code logs in their whole party, and then each guest has an Event RSVP for every event they're invited to."
> **Dev:** "And the info-collection link uses that same code?"
> **Couple:** "No. That's the info token, a different random link we send out early. The RSVP code is a surprise on the printed invite, so it can't appear in the info-collection URL."

## Flagged ambiguities

- "RSVP" was used to mean both a single wedding-wide response and a per-event response. Resolved: RSVP is always per-event (**Event RSVP**); there is no wedding-wide RSVP.
- "Code" was ambiguous between the early info-collection link and the printed RSVP credential. Resolved: these are two distinct per-party values, the **Info Token** and the **RSVP Code**.
- Side / Relation / Circle / Tags were initially treated as guest attributes. Resolved: Side, Relation, and Circle are party-level; Tags are guest-level.
- The PRD and issue #4 called the guest attribute "roles". Resolved: the attribute is **Tags** (a deliberate rename during implementation); "roles" is reserved for auth role claims (admin, guest) and should not be used for the guest attribute.
- "Address" was assumed to be per-guest. Resolved: the mailing address is party-level (one envelope per party); only email and phone are per-guest.
- "Complete" was overloaded between "has all required fields" (a data condition) and **Info Collection Status** = complete (a tracked state). Resolved: all-fields-present is necessary for complete, but once a party is **Info Collection Requested** the guest must submit the form (or the couple must mark it complete): data presence alone no longer completes it.
- "Placeholder" had drifted toward "any guest whose name is uncertain". Resolved: a **Placeholder Guest** is strictly an unnamed plus-one slot, identified by its **Placeholder Text**; a guest whose name is only approximately known is a real guest with a best-guess name, corrected during **Info Collection**.
