import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadProgress,
  saveProgress,
} from "@/components/library/crossword/progress";

describe("crossword progress", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips progress through localStorage", () => {
    saveProgress("test-puzzle", {
      entries: ".KISS????????????????????",
      difficulty: "medium",
    });

    expect(loadProgress("test-puzzle")).toEqual({
      entries: ".KISS????????????????????",
      difficulty: "medium",
    });
  });

  it("keys progress per puzzle", () => {
    saveProgress("puzzle-a", { entries: "A???", difficulty: "easy" });

    expect(loadProgress("puzzle-b")).toBeNull();
  });

  it("returns null when nothing is saved", () => {
    expect(loadProgress("test-puzzle")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    localStorage.setItem("crossword:test-puzzle:progress", "{not json");

    expect(loadProgress("test-puzzle")).toBeNull();
  });

  it("returns null when entries is not a string", () => {
    localStorage.setItem(
      "crossword:test-puzzle:progress",
      JSON.stringify({ entries: 42, difficulty: "easy" }),
    );

    expect(loadProgress("test-puzzle")).toBeNull();
  });

  it("returns null for an unknown difficulty", () => {
    localStorage.setItem(
      "crossword:test-puzzle:progress",
      JSON.stringify({ entries: "????", difficulty: "impossible" }),
    );

    expect(loadProgress("test-puzzle")).toBeNull();
  });

  describe("when storage is unavailable", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("saveProgress swallows storage errors", () => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("quota exceeded");
      });

      expect(() =>
        saveProgress("test-puzzle", { entries: "????", difficulty: "easy" }),
      ).not.toThrow();
    });

    it("loadProgress returns null on storage errors", () => {
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("storage disabled");
      });

      expect(loadProgress("test-puzzle")).toBeNull();
    });
  });
});
