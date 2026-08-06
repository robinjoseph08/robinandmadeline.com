import { describe, expect, it } from "vitest";

import {
  getPuzzleBySlug,
  getPuzzleTitle,
  PUZZLES_BY_SLUG,
} from "@/components/library/crossword/puzzles";

describe("getPuzzleBySlug", () => {
  it("registers only the publicly playable proposal crossword", () => {
    const proposal = getPuzzleBySlug("proposal");

    expect(Object.keys(PUZZLES_BY_SLUG)).toEqual(["proposal"]);
    expect(proposal?.id).toBe("proposal-v1");
    expect(proposal?.width).toBe(15);
    expect(proposal?.difficulties).toEqual(["easy", "hard"]);
    expect(proposal?.celebration?.kind).toBe("proposal");
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
  it("preserves friendly titles for public and retired puzzle records", () => {
    expect(getPuzzleTitle("wedding-mini-v1")).toBe("The Wedding Mini");
    expect(getPuzzleTitle("wedding-full-v1")).toBe("The Wedding Crossword");
    expect(getPuzzleTitle("proposal-v1")).toBe("The Proposal Crossword");
  });

  it("falls back to the raw id for an unknown puzzle, including inherited keys", () => {
    expect(getPuzzleTitle("retired-puzzle-v0")).toBe("retired-puzzle-v0");
    // The hasOwn guard keeps a prototype key from resolving to a junk title.
    expect(getPuzzleTitle("constructor")).toBe("constructor");
  });
});
