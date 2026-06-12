import { describe, expect, it } from "vitest";

import {
  CrosswordPuzzle,
  DIFFICULTIES,
  entriesFromGrid,
  gridFromEntries,
  validatePuzzle,
} from "@/components/library/crossword/puzzle";
import { weddingCrossword } from "@/components/library/crossword/puzzle-data";

function clone(puzzle: CrosswordPuzzle): CrosswordPuzzle {
  return JSON.parse(JSON.stringify(puzzle)) as CrosswordPuzzle;
}

describe("validatePuzzle", () => {
  it("accepts the shipped wedding crossword", () => {
    expect(validatePuzzle(weddingCrossword)).toEqual([]);
  });

  it("provides clue sets for every difficulty with distinct text", () => {
    // The same answers get different clue text per difficulty, so switching
    // difficulty must actually change what guests read.
    for (const direction of ["across", "down"] as const) {
      for (const number of Object.keys(
        weddingCrossword.clues.easy[direction],
      )) {
        const texts = DIFFICULTIES.map(
          (difficulty) => weddingCrossword.clues[difficulty][direction][number],
        );
        expect(new Set(texts).size).toBe(DIFFICULTIES.length);
      }
    }
  });

  it("rejects an empty id and non-positive dimensions", () => {
    const puzzle = clone(weddingCrossword);
    puzzle.id = "";
    puzzle.width = 0;
    expect(validatePuzzle(puzzle)).toEqual([
      "puzzle id must not be empty",
      "width must be a positive integer, got 0",
      "solution must have 0 characters (width x height), got 25",
    ]);
  });

  it("rejects a solution whose length does not match the grid", () => {
    const puzzle = clone(weddingCrossword);
    puzzle.solution = puzzle.solution.slice(0, -1);
    expect(validatePuzzle(puzzle)).toEqual([
      "solution must have 25 characters (width x height), got 24",
    ]);
  });

  it("rejects a solution with characters outside A-Z and '.'", () => {
    const puzzle = clone(weddingCrossword);
    puzzle.solution = puzzle.solution.replace("K", "k");
    expect(validatePuzzle(puzzle)).toEqual([
      "solution may only contain uppercase letters and '.' for blocks",
    ]);
  });

  it("reports a difficulty missing a clue for a word in the grid", () => {
    const puzzle = clone(weddingCrossword);
    delete puzzle.clues.medium.across["5"];
    expect(validatePuzzle(puzzle)).toEqual([
      "medium is missing a clue for 5 across",
    ]);
  });

  it("reports a clue for a word the grid does not contain", () => {
    const puzzle = clone(weddingCrossword);
    puzzle.clues.hard.down["9"] = "A clue with no home";
    expect(validatePuzzle(puzzle)).toEqual([
      "hard has a clue for 9 down, but the grid has no such word",
    ]);
  });
});

describe("gridFromEntries", () => {
  it("builds an empty grid when there are no saved entries", () => {
    const grid = gridFromEntries(weddingCrossword);
    expect(grid.width).toBe(5);
    expect(grid.height).toBe(5);
    expect(grid.squares[0].type).toBe("block");
    expect(grid.squares.every((square) => square.solution === undefined)).toBe(
      true,
    );
  });

  it("restores saved letters into the right squares", () => {
    const grid = gridFromEntries(weddingCrossword, `.K${"?".repeat(22)}.`);
    expect(grid.squares[1].solution).toBe("K");
    expect(grid.squares[2].solution).toBeUndefined();
  });

  it("ignores entries with the wrong length", () => {
    const grid = gridFromEntries(weddingCrossword, ".K??");
    expect(grid.squares[1].solution).toBeUndefined();
  });

  it("ignores entries whose blocks do not match the puzzle", () => {
    // Same length, but the leading block moved from index 0 to index 1.
    const entries = `K.${"?".repeat(22)}.`;
    const grid = gridFromEntries(weddingCrossword, entries);
    expect(grid.squares[0].type).toBe("block");
    expect(grid.squares.every((square) => square.solution === undefined)).toBe(
      true,
    );
  });

  it("round-trips through entriesFromGrid", () => {
    const entries = `.KISS${"?".repeat(19)}.`;
    const grid = gridFromEntries(weddingCrossword, entries);
    expect(entriesFromGrid(grid)).toBe(entries);
  });
});
