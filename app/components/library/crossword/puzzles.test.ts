import { describe, expect, it } from "vitest";

import {
  getPuzzleBySlug,
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
