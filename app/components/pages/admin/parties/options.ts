/**
 * Enum option lists for the parties/guests admin UI, derived from the generated
 * model unions so a value can never drift from the backend. Each entry pairs the
 * wire value with a human label for the form selects and filter controls.
 */

import type { SortLevel } from "@/libraries/sortSpec";
import {
  CircleChildhood,
  CircleCollege,
  CircleExtended,
  CircleImmediate,
  CircleOther,
  CircleWork,
  InvitationDigital,
  InvitationPhysical,
  RelationFamily,
  RelationFriend,
  RSVPAttending,
  RSVPNotAttending,
  RSVPPending,
  SideMadeline,
  SideRobin,
  StatusComplete,
  StatusIncomplete,
  type Circle,
  type EventRSVPStatus,
  type InfoCollectionStatus,
  type InvitationType,
  type Relation,
  type Side,
} from "@/types/generated/models";

export interface Option<T extends string> {
  value: T;
  label: string;
}

export const SIDE_OPTIONS: Option<Side>[] = [
  { value: SideRobin, label: "Robin" },
  { value: SideMadeline, label: "Madeline" },
];

export const RELATION_OPTIONS: Option<Relation>[] = [
  { value: RelationFamily, label: "Family" },
  { value: RelationFriend, label: "Friend" },
];

export const INVITATION_TYPE_OPTIONS: Option<InvitationType>[] = [
  { value: InvitationPhysical, label: "Physical" },
  { value: InvitationDigital, label: "Digital" },
];

export const CIRCLE_OPTIONS: Option<Circle>[] = [
  { value: CircleImmediate, label: "Immediate" },
  { value: CircleExtended, label: "Extended" },
  { value: CircleCollege, label: "College" },
  { value: CircleWork, label: "Work" },
  { value: CircleChildhood, label: "Childhood" },
  { value: CircleOther, label: "Other" },
];

export const INFO_STATUS_OPTIONS: Option<InfoCollectionStatus>[] = [
  { value: StatusComplete, label: "Complete" },
  { value: StatusIncomplete, label: "Incomplete" },
];

export const RSVP_STATUS_OPTIONS: Option<EventRSVPStatus>[] = [
  { value: RSVPPending, label: "Pending" },
  { value: RSVPAttending, label: "Attending" },
  { value: RSVPNotAttending, label: "Not attending" },
];

// Sortable fields for the parties and guests lists, in the order the sort sheet
// renders them. The `field` tokens are the wire vocabulary of a sort spec and
// must match pkg/sortspec (PartyFields / GuestFields) exactly; an unknown field
// is a 422 from the binder, so a drift surfaces immediately. The "party" field
// (guests only) sorts by the owning party's name; "invitation" is parties only.
export interface SortFieldOption {
  field: string;
  label: string;
}

export const PARTY_SORT_FIELDS: SortFieldOption[] = [
  { field: "name", label: "Name" },
  { field: "date_added", label: "Date added" },
  { field: "side", label: "Side" },
  { field: "relation", label: "Relation" },
  { field: "invitation", label: "Invitation" },
];

export const GUEST_SORT_FIELDS: SortFieldOption[] = [
  { field: "name", label: "Name" },
  { field: "party", label: "Party" },
  { field: "date_added", label: "Date added" },
  { field: "side", label: "Side" },
  { field: "relation", label: "Relation" },
];

// Stable field-token sets for parseSortSpec (which rejects unknown fields) and
// for useSortDefault. Module-level so their identity is stable across renders.
export const PARTY_SORT_FIELD_SET: ReadonlySet<string> = new Set(
  PARTY_SORT_FIELDS.map((f) => f.field),
);
export const GUEST_SORT_FIELD_SET: ReadonlySet<string> = new Set(
  GUEST_SORT_FIELDS.map((f) => f.field),
);

// The builtin default sort: creation order, oldest first, the order the lists
// used before sorting existed. Mirrors sortspec.Builtin() in Go. A saved
// per-browser default (localStorage) overrides this; an explicit URL sort
// overrides both.
export const BUILTIN_PARTY_SORT: SortLevel[] = [
  { field: "date_added", direction: "asc" },
];
export const BUILTIN_GUEST_SORT: SortLevel[] = [
  { field: "date_added", direction: "asc" },
];

// localStorage keys for each list's saved default sort.
export const PARTY_SORT_STORAGE_KEY = "admin:parties:defaultSort";
export const GUEST_SORT_STORAGE_KEY = "admin:guests:defaultSort";

/** Looks up the display label for a wire value, falling back to the raw value. */
export function labelFor<T extends string>(
  options: Option<T>[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
