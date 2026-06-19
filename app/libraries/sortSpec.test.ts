import { describe, expect, it } from "vitest";

import {
  parseSortSpec,
  serializeSortSpec,
  sortSpecsEqual,
  type SortLevel,
} from "./sortSpec";

// The grammar mirrors pkg/sortspec (Go); these cases mirror sortspec_test.go so
// the two stay in lockstep. The valid-field set stands in for a list's whitelist.
const FIELDS = new Set(["name", "side", "date_added"]);

describe("parseSortSpec", () => {
  it("parses a single level", () => {
    expect(parseSortSpec("name:asc", FIELDS)).toEqual([
      { field: "name", direction: "asc" },
    ]);
  });

  it("parses multiple levels in order", () => {
    expect(parseSortSpec("side:asc,name:desc", FIELDS)).toEqual([
      { field: "side", direction: "asc" },
      { field: "name", direction: "desc" },
    ]);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "name:asc, side:asc"],
    ["missing colon", "name"],
    ["empty direction", "name:"],
    ["bad direction", "name:sideways"],
    ["trailing junk", "name:asc:extra"],
    ["empty pair", "name:asc,,side:asc"],
    ["duplicate field", "name:asc,name:desc"],
    ["unknown field", "bogus:asc"],
  ])("rejects %s", (_label, spec) => {
    expect(parseSortSpec(spec, FIELDS)).toBeNull();
  });

  it("rejects more than the max levels", () => {
    const many = Array.from({ length: 9 }, (_, i) => `f${i}:asc`).join(",");
    const allFields = new Set(Array.from({ length: 9 }, (_, i) => `f${i}`));
    expect(parseSortSpec(many, allFields)).toBeNull();
  });
});

describe("serializeSortSpec", () => {
  it("round-trips a parsed spec", () => {
    const spec = "side:asc,name:desc";
    const levels = parseSortSpec(spec, FIELDS);
    expect(levels).not.toBeNull();
    expect(serializeSortSpec(levels as SortLevel[])).toBe(spec);
  });

  it("serializes an empty array to an empty string", () => {
    expect(serializeSortSpec([])).toBe("");
  });
});

describe("sortSpecsEqual", () => {
  const a: SortLevel[] = [{ field: "name", direction: "asc" }];

  it("is true for identical specs", () => {
    expect(sortSpecsEqual(a, [{ field: "name", direction: "asc" }])).toBe(true);
  });

  it("is order-sensitive", () => {
    const x: SortLevel[] = [
      { field: "name", direction: "asc" },
      { field: "side", direction: "asc" },
    ];
    const y: SortLevel[] = [
      { field: "side", direction: "asc" },
      { field: "name", direction: "asc" },
    ];
    expect(sortSpecsEqual(x, y)).toBe(false);
  });

  it("treats both-null as equal but null-vs-list as unequal", () => {
    expect(sortSpecsEqual(null, null)).toBe(true);
    expect(sortSpecsEqual(a, null)).toBe(false);
  });
});
