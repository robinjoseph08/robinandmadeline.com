import { describe, expect, it } from "vitest";

import {
  CircleChildhood,
  CircleCollege,
  CircleExtended,
  CircleImmediate,
  CircleOther,
  CircleWork,
  SideMadeline,
  SideRobin,
} from "@/types/generated/models";

import { chipColorClass } from "./chips";

describe("chipColorClass", () => {
  // Closed sets get explicit, designed colors rather than hashed ones. These
  // assertions also guard the value of each mapping: TypeScript catches a
  // missing circle key, but only a test catches a wrong color pasted onto one.
  it.each([
    [CircleImmediate, "bg-rose-200 text-rose-900"],
    [CircleExtended, "bg-amber-200 text-amber-900"],
    [CircleCollege, "bg-blue-200 text-blue-900"],
    [CircleWork, "bg-fuchsia-200 text-fuchsia-900"],
    [CircleChildhood, "bg-emerald-200 text-emerald-900"],
    [CircleOther, "bg-stone-200 text-stone-900"],
  ])("gives circle %s its explicit color", (value, expected) => {
    expect(chipColorClass(value)).toBe(expected);
  });

  // A party's side reads in the couple's colors: blue for Robin, pink for
  // Madeline. Keyed by the wire value, since the chip shows the "Robin" /
  // "Madeline" label but colors by value.
  it.each([
    [SideRobin, "bg-blue-200 text-blue-900"],
    [SideMadeline, "bg-pink-200 text-pink-900"],
  ])("gives side %s its explicit color", (value, expected) => {
    expect(chipColorClass(value)).toBe(expected);
  });

  // Flags are keyed by the label GridFlagsCell renders, not the field key. The
  // first cases pin the colors; the last guards against a caller switching to
  // option.key, which would silently fall through to a hashed color.
  it.each([
    ["Child", "bg-sky-200 text-sky-900"],
    ["Drinking", "bg-purple-200 text-purple-900"],
  ])("gives flag label %s its explicit color", (label, expected) => {
    expect(chipColorClass(label)).toBe(expected);
  });

  it.each(["is_child", "is_drinking"])(
    "does not treat flag key %s as an explicit value",
    (key) => {
      expect([
        "bg-sky-200 text-sky-900",
        "bg-purple-200 text-purple-900",
      ]).not.toContain(chipColorClass(key));
    },
  );

  // The whole reason the tag hash uses a tuned multiplier: tags that co-occur on
  // a real guest must resolve to different colors, so their chips stay
  // distinguishable in the same cell. The four-way friend group is the tightest
  // real grouping; the two pairs below both collide if the multiplier reverts to
  // the old 31, so this test fails on that regression. These are known
  // co-occurring groups from the guest list; a new collision is a deliberate
  // re-tuning event that should update this list.
  it.each([
    [["Closest Friends", "JHHS", "UTD", "Yippees"]],
    [["In-Law", "Parent"]],
    [["Bridal Party", "Closest Friends"]],
  ])("gives co-occurring tags %s distinct colors", (group) => {
    const colors = group.map(chipColorClass);
    expect(new Set(colors).size).toBe(group.length);
  });

  // A value always resolves to the same well-formed palette class, so a chip
  // reads the same everywhere and never renders with no color. "constructor"
  // checks the Map guard against inherited object properties.
  it.each(["Yippees", "In-Law", "Some Brand-New Tag", "", "constructor"])(
    "is stable and well-formed for %o",
    (value) => {
      const color = chipColorClass(value);
      expect(color).toBe(chipColorClass(value));
      expect(color).toMatch(/^bg-[a-z]+-200 text-[a-z]+-900$/);
    },
  );
});
