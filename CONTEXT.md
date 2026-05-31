# Wedding Website

The domain language for robinandmadeline.com — a custom wedding site that manages the guest list, two-phase guest interaction (info collection then RSVP), the event schedule, photo groups, and email communications.

## Language

**Party**:
A group of guests who receive a single invitation and share one mailing address and one RSVP code.
_Avoid_: Household, group, family (a party isn't always a family)

**Guest**:
An individual person belonging to exactly one party.
_Avoid_: Invitee, attendee (attendance isn't known until they RSVP)

**Primary Guest**:
The guest who is the main point of contact for their party.
_Avoid_: Head of household, owner

**Placeholder Guest**:
A stub guest record (e.g. an unnamed plus-one or child) whose real details the party fills in during RSVP.
_Avoid_: Plus-one (a placeholder may be a child, not a plus-one)

**Side**:
Whether a party is Robin's or Madeline's. A party-level attribute with exactly one value.
_Avoid_: Kingdom (the spreadsheet's name — not used in the system)

**Relation**:
Whether a party is family or friends. A party-level attribute with exactly one value.
_Avoid_: Phylum

**Circle**:
How the couple knows a party (Immediate, Extended, College, Work, Childhood, Other). A party-level attribute that can hold multiple values.
_Avoid_: Class

**Roles**:
A guest's relationship tags (Sibling, In-Law, Bridal Party, Cousin, UIUC, etc.). A guest-level attribute that can hold multiple values.
_Avoid_: Order, tags

**Event**:
A scheduled wedding activity (Rehearsal Dinner / Madhuram Veppu, Ceremony, Reception, possibly Brunch).

**Public Event**:
An event visible on the schedule to anyone, with no code required.

**Private Event**:
An event visible only to guests who are invited to it.

**Madhuram Veppu**:
A ceremony combined with the Rehearsal Dinner, attended by a larger group than a typical rehearsal dinner.

**Event RSVP**:
A guest's response to a single event — pending, attending, or not_attending. The existence of an Event RSVP record is what marks a guest as invited to that event.
_Avoid_: RSVP (unqualified — there is no single wedding-wide RSVP; attendance is per-event)

**Info Token**:
A random, opaque per-party token embedded in the pre-invitation info-collection URL.
_Avoid_: Code (guests never see this as a code)

**RSVP Code**:
A memorable, often personalized per-party code (e.g. KALEL, PEPPER) revealed on the printed invitation and used to authenticate the RSVP flow.
_Avoid_: Password, info token

**Invitation Type**:
Whether a party receives a physical mailed invitation or a digital-only one.

**Photo Group**:
A named set of guests needed together for a specific photo at an event, with a shooting order.
_Avoid_: Photo shoot, album (the photo gallery is unrelated)

## Relationships

- A **Party** has one or more **Guests**; exactly one is the **Primary Guest**.
- A **Party** has one **Side**, one **Relation**, and one or more **Circles**.
- A **Guest** has zero or more **Roles**.
- A **Party** has one **Info Token** and one **RSVP Code**.
- A **Guest** has one **Event RSVP** per **Event** they are invited to.
- A **Photo Group** belongs to one **Event** and contains one or more **Guests**.
- A **Guest** carries individual email, phone, dietary restrictions, and RSVP responses; the mailing **address** lives on the **Party**.
- Overall attendance is derived — a **Guest** is "coming" if they are attending at least one **Event**.

## Example dialogue

> **Dev:** "When a guest enters their RSVP code, are they RSVPing to the wedding?"
> **Couple:** "No — there's no single wedding RSVP. The code logs in their whole party, and then each guest has an Event RSVP for every event they're invited to."
> **Dev:** "And the info-collection link uses that same code?"
> **Couple:** "No. That's the info token — a different, random link we send out early. The RSVP code is a surprise on the printed invite, so it can't appear in the info-collection URL."

## Flagged ambiguities

- "RSVP" was used to mean both a single wedding-wide response and a per-event response — resolved: RSVP is always per-event (**Event RSVP**); there is no wedding-wide RSVP.
- "Code" was ambiguous between the early info-collection link and the printed RSVP credential — resolved: these are two distinct per-party values, the **Info Token** and the **RSVP Code**.
- Side / Relation / Circle / Roles were initially treated as guest attributes — resolved: Side, Relation, and Circle are party-level; Roles are guest-level.
- "Address" was assumed to be per-guest — resolved: the mailing address is party-level (one envelope per party); only email and phone are per-guest.
