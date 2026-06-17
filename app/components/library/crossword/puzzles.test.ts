import { describe, expect, it } from "vitest";

import {
  getPuzzleBySlug,
  getPuzzleTitle,
  PUZZLES_BY_SLUG,
} from "@/components/library/crossword/puzzles";

describe("getPuzzleBySlug", () => {
  it("resolves the mini and crossword slugs to distinct puzzles", () => {
    const mini = getPuzzleBySlug("mini");
    const full = getPuzzleBySlug("crossword");

    expect(mini?.id).toBe("wedding-mini-v1");
    expect(mini?.width).toBe(5);
    expect(full?.id).toBe("wedding-full-v1");
    expect(full?.width).toBe(15);
  });

  it("gives every registered puzzle a unique id, keeping saved progress per puzzle", () => {
    const ids = Object.values(PUZZLES_BY_SLUG).map((puzzle) => puzzle.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns undefined for unknown slugs, including inherited object keys", () => {
    expect(getPuzzleBySlug("does-not-exist")).toBeUndefined();
    // Without a hasOwn guard, "constructor" would resolve via the prototype.
    expect(getPuzzleBySlug("constructor")).toBeUndefined();
  });
});

describe("getPuzzleTitle", () => {
  it("maps a stored puzzle id to its friendly title", () => {
    expect(getPuzzleTitle("wedding-mini-v1")).toBe("The Wedding Mini");
    expect(getPuzzleTitle("wedding-full-v1")).toBe("The Wedding Crossword");
  });

  it("falls back to the raw id for an unknown puzzle, including inherited keys", () => {
    expect(getPuzzleTitle("retired-puzzle-v0")).toBe("retired-puzzle-v0");
    // The hasOwn guard keeps a prototype key from resolving to a junk title.
    expect(getPuzzleTitle("constructor")).toBe("constructor");
  });
});
