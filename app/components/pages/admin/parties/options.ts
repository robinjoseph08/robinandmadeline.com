/**
 * Enum option lists for the parties/guests admin UI, derived from the generated
 * model unions so a value can never drift from the backend. Each entry pairs the
 * wire value with a human label for the form selects and filter controls.
 */

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
  SideMadeline,
  SideRobin,
  StatusComplete,
  StatusIncomplete,
  type Circle,
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

/** Looks up the display label for a wire value, falling back to the raw value. */
export function labelFor<T extends string>(
  options: Option<T>[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
