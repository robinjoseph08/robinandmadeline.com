# Wedding Website — Domain Context

## Glossary

- **Party**: A group of guests who receive a single invitation and share an RSVP code. Has a `side` (Robin/Madeline), `relation` (family/friend), and `circle` (Immediate, Extended, College, Work, Childhood, Other). Examples: "Joseph ABQ", "Abernathy".
- **Guest**: An individual person within a Party. Has `roles` (Sibling, Bridal Party, In-Law, UIUC, etc.), dietary restrictions, and individual contact info (email, phone). A guest can be a placeholder (stub for plus-ones or children to be filled in later).
- **Primary Guest**: The main contact person for a Party. Receives communications and manages the party's info and RSVPs.
- **Event**: A scheduled activity (Rehearsal Dinner/Madhuram Veppu, Ceremony, Reception, possibly Brunch). Can be public (visible to all site visitors) or private (visible only to invited guests after authentication).
- **Event RSVP**: A per-guest, per-event response (pending, attending, not_attending). The existence of an RSVP row means the guest is invited to that event. Public events get RSVP rows for all guests.
- **Info Token**: A random, opaque token per Party used for the pre-invitation info-collection flow. Guests don't see this as a "code" — it's embedded in a URL.
- **RSVP Code**: A fun, personalized code per Party (e.g., "KALEL", "PEPPER") revealed on the printed invitation. Used to authenticate for the RSVP flow. Can be custom or auto-generated.
- **Photo Group**: A named group of guests who need to be present for a specific set of photos at an event. Has a sort order indicating shooting sequence. Surfaced to guests on their personalized schedule so they know to stay nearby.
- **Invitation Type**: Whether a Party receives a physical mailed invitation or a digital-only one. Affects whether address collection is needed.

## Key Domain Rules

- A Party belongs to one side (Robin or Madeline) and has one relation type (family or friend). Circle and roles can be multiple.
- Guests within the same Party share a mailing address (stored on the Party) and invitation type, but have individual email, phone, roles, dietary restrictions, and RSVP responses.
- Public events are visible on the schedule without authentication. Private events are only visible to guests who are invited (have an RSVP row).
- The info-collection phase happens before invitations go out. The RSVP phase happens after invitations are mailed. These use separate tokens/codes intentionally — the RSVP code is a surprise revealed on the printed invite.
- When a new guest is added, RSVP rows are auto-created for all public events. When a new public event is created, RSVP rows are auto-created for all guests.
- Photo groups are tied to events and shown inline on the personalized schedule, not as a separate section.
- Overall attendance is derived — a guest is "coming" if they're attending at least one event.

## Scale

- ~174 guests, ~200 max venue capacity
- 3 confirmed events (Rehearsal Dinner/Madhuram Veppu, Ceremony, Reception), 1 possible (Brunch)
- 2 admins (Robin and Madeline)
