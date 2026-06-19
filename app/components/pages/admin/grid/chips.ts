import {
  type Circle,
  CircleChildhood,
  CircleCollege,
  CircleExtended,
  CircleImmediate,
  CircleOther,
  CircleWork,
} from "@/types/generated/models";

/**
 * Chip colors for the admin grids, comboboxes, and filter chips. Two tiers:
 *
 *   - Fixed-set values (a party's circle, a guest's flags) get an explicit,
 *     hand-picked color, so they read consistently and a little semantically.
 *   - Open-ended values (guest tags) hash into a curated palette. The multiplier
 *     is tuned so no two tags that co-occur on a real guest land on the same
 *     color — a shared color only misleads when two chips sit in the same cell.
 *
 * A given value always resolves to the same color everywhere it appears (row,
 * dropdown, filter). Every class is a literal string so Tailwind's scanner keeps it.
 */

// The "Bouquet + slate" palette: 14 soft Tailwind tints, on-brand (the acidic
// yellow/lime/cyan are dropped) and large enough to spread the tags well. Order
// matters: it is the lookup table the tag hash indexes into.
const TAG_COLORS = [
  "bg-rose-200 text-rose-900",
  "bg-orange-200 text-orange-900",
  "bg-amber-200 text-amber-900",
  "bg-emerald-200 text-emerald-900",
  "bg-teal-200 text-teal-900",
  "bg-sky-200 text-sky-900",
  "bg-blue-200 text-blue-900",
  "bg-indigo-200 text-indigo-900",
  "bg-slate-200 text-slate-900",
  "bg-violet-200 text-violet-900",
  "bg-purple-200 text-purple-900",
  "bg-fuchsia-200 text-fuchsia-900",
  "bg-pink-200 text-pink-900",
  "bg-stone-200 text-stone-900",
] as const;

// A party's circle is a closed enum, so each value gets a designed color: warm
// for the closest family, cooling outward, neutral for "Other".
const CIRCLE_CHIP_COLOR: Record<Circle, string> = {
  [CircleImmediate]: "bg-rose-200 text-rose-900",
  [CircleExtended]: "bg-amber-200 text-amber-900",
  [CircleChildhood]: "bg-emerald-200 text-emerald-900",
  [CircleCollege]: "bg-blue-200 text-blue-900",
  [CircleWork]: "bg-fuchsia-200 text-fuchsia-900",
  [CircleOther]: "bg-stone-200 text-stone-900",
};

// A guest's flags, keyed by the chip label GridFlagsCell renders (mirrors
// GUEST_FLAG_OPTIONS in GuestsGrid).
const FLAG_CHIP_COLOR: Record<string, string> = {
  Child: "bg-sky-200 text-sky-900",
  Drinking: "bg-purple-200 text-purple-900",
};

// Merged lookup for the explicit (non-hashed) values. A Map so an exotic value
// (e.g. a tag literally named "constructor") can't match an inherited property.
const EXPLICIT_CHIP_COLOR = new Map<string, string>([
  ...Object.entries(CIRCLE_CHIP_COLOR),
  ...Object.entries(FLAG_CHIP_COLOR),
]);

/** Returns a stable `bg-* text-*` class pair for a chip value. */
export function chipColorClass(value: string): string {
  const explicit = EXPLICIT_CHIP_COLOR.get(value);
  if (explicit) return explicit;

  // Polynomial string hash; the ×77 multiplier is tuned against the real guest
  // list so co-occurring tags resolve to different colors (see the doc above).
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 77 + value.charCodeAt(i)) >>> 0;
  }
  return TAG_COLORS[hash % TAG_COLORS.length];
}
