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
An unnamed plus-one slot: a guest record that carries Placeholder Text (its permanent descriptor, e.g. "Guest of John Doe"). Naming it during RSVP sets the guest's name without erasing the descriptor, and the name stays editable until the RSVP deadline so a party can swap who fills the slot. A person whose name is only approximately known is a real guest with a best-guess name (corrected during info collection), not a placeholder.
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
The pre-invitation phase in which a party confirms its contact details and, for physical parties, its mailing address, and corrects guest details the couple has wrong (e.g. an approximate name).
_Avoid_: Onboarding, signup

**Info Collection Requested**:
A party whose info link has been sent, delegating info gathering to the guest.
_Avoid_: Invited (reserved for events)

**Info Collection Status**:
Whether a party's info collection is complete or incomplete.

**Photo Group**:
A named set of guests needed together for a specific photo at an event, with a shooting order.
_Avoid_: Photo shoot, album (the photo gallery is unrelated)

## Relationships

- A **Party** has one or more **Guests**; exactly one is the **Primary Guest**.
- A **Party** is born with its first **Guest** (who starts as its **Primary Guest**) and never exists empty: deleting the last **Guest** deletes the **Party**.
- When the **Primary Guest** leaves a **Party** (deleted, or moved to another party), the oldest remaining **Guest** is promoted; unsetting the sole primary is refused.
- A **Party** has one **Side**, one **Relation**, and one or more **Circles**.
- A **Guest** has zero or more **Tags**.
- A **Placeholder Guest** carries **Placeholder Text**; naming the slot (during RSVP, until the deadline) never erases the descriptor, so the slot stays identifiable and re-nameable.
- A **Party** has one **Info Token** and one **RSVP Code**.
- A **Guest** has one **Event RSVP** per **Event** they are invited to.
- A **Photo Group** belongs to one **Event** and contains one or more **Guests**.
- A **Guest** carries individual email, phone, dietary restrictions, and RSVP responses; the mailing **address** lives on the **Party**.
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
