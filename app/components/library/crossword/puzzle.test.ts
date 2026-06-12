import { describe, expect, it } from "vitest";

import {
  CrosswordPuzzle,
  DIFFICULTIES,
  entriesFromGrid,
  gridFromEntries,
  validatePuzzle,
} from "@/components/library/crossword/puzzle";
import { weddingMini } from "@/components/library/crossword/puzzle-data";
import { weddingFull } from "@/components/library/crossword/puzzle-data-full";

function clone(puzzle: CrosswordPuzzle): CrosswordPuzzle {
  return JSON.parse(JSON.stringify(puzzle)) as CrosswordPuzzle;
}

const shippedPuzzles = [weddingMini, weddingFull];

describe("validatePuzzle", () => {
  it.each(shippedPuzzles.map((puzzle) => [puzzle.id, puzzle] as const))(
    "accepts the shipped %s puzzle",
    (_id, puzzle) => {
      expect(validatePuzzle(puzzle)).toEqual([]);
    },
  );

  it.each(shippedPuzzles.map((puzzle) => [puzzle.id, puzzle] as const))(
    "%s provides clue sets for every difficulty with distinct text",
    (_id, puzzle) => {
      // The same answers get different clue text per difficulty, so switching
      // difficulty must actually change what guests read.
      for (const direction of ["across", "down"] as const) {
        for (const number of Object.keys(puzzle.clues.easy[direction])) {
          const texts = DIFFICULTIES.map(
            (difficulty) => puzzle.clues[difficulty][direction][number],
          );
          expect(new Set(texts).size).toBe(DIFFICULTIES.length);
        }
      }
    },
  );

  it("rejects an empty id and non-positive dimensions", () => {
    const puzzle = clone(weddingMini);
    puzzle.id = "";
    puzzle.width = 0;
    expect(validatePuzzle(puzzle)).toEqual([
      "puzzle id must not be empty",
      "width must be a positive integer, got 0",
      "solution must have 0 characters (width x height), got 25",
    ]);
  });

  it("rejects a solution whose length does not match the grid", () => {
    const puzzle = clone(weddingMini);
    puzzle.solution = puzzle.solution.slice(0, -1);
    expect(validatePuzzle(puzzle)).toEqual([
      "solution must have 25 characters (width x height), got 24",
    ]);
  });

  it("rejects a solution with characters outside A-Z and '.'", () => {
    const puzzle = clone(weddingMini);
    puzzle.solution = puzzle.solution.replace("K", "k");
    expect(validatePuzzle(puzzle)).toEqual([
      "solution may only contain uppercase letters and '.' for blocks",
    ]);
  });

  it("reports a difficulty missing a clue for a word in the grid", () => {
    const puzzle = clone(weddingMini);
    delete puzzle.clues.medium.across["5"];
    expect(validatePuzzle(puzzle)).toEqual([
      "medium is missing a clue for 5 across",
    ]);
  });

  it("reports a clue for a word the grid does not contain", () => {
    const puzzle = clone(weddingMini);
    puzzle.clues.hard.down["9"] = "A clue with no home";
    expect(validatePuzzle(puzzle)).toEqual([
      "hard has a clue for 9 down, but the grid has no such word",
    ]);
  });

  it("rejects a grid with a square that belongs to no word", () => {
    // The C at row 1, col 2 is fenced in by blocks and the grid edge, so it
    // is part of no across or down word and no clue could ever reach it:
    //
    //   A B .
    //   . . C
    //   D E .
    const clueSet = { across: { "1": "AB", "2": "DE" }, down: {} };
    const puzzle: CrosswordPuzzle = {
      id: "isolated-square",
      title: "Isolated Square",
      width: 3,
      height: 3,
      solution: "AB...CDE.",
      clues: { easy: clueSet, medium: clueSet, hard: clueSet },
    };
    expect(validatePuzzle(puzzle)).toEqual([
      "the square at row 1, column 2 belongs to no across or down word, so it can never be clued",
    ]);
  });
});

describe("gridFromEntries", () => {
  it("builds an empty grid when there are no saved entries", () => {
    const grid = gridFromEntries(weddingMini);
    expect(grid.width).toBe(5);
    expect(grid.height).toBe(5);
    expect(grid.squares[0].type).toBe("block");
    expect(grid.squares.every((square) => square.solution === undefined)).toBe(
      true,
    );
  });

  it("restores saved letters into the right squares", () => {
    const grid = gridFromEntries(weddingMini, `.K${"?".repeat(22)}.`);
    expect(grid.squares[1].solution).toBe("K");
    expect(grid.squares[2].solution).toBeUndefined();
  });

  it("ignores entries with the wrong length", () => {
    const grid = gridFromEntries(weddingMini, ".K??");
    expect(grid.squares[1].solution).toBeUndefined();
  });

  it("restores unexpected characters as empty squares", () => {
    // A save written by this app only contains letters, ".", and "?", but a
    // hand-edited one can hold anything; junk must not render as content.
    const entries = `.k1S!${"?".repeat(19)}.`;
    const grid = gridFromEntries(weddingMini, entries);
    expect(grid.squares[1].solution).toBeUndefined();
    expect(grid.squares[2].solution).toBeUndefined();
    expect(grid.squares[3].solution).toBe("S");
    expect(grid.squares[4].solution).toBeUndefined();
  });

  it("ignores entries whose blocks do not match the puzzle", () => {
    // Same length, but the leading block moved from index 0 to index 1.
    const entries = `K.${"?".repeat(22)}.`;
    const grid = gridFromEntries(weddingMini, entries);
    expect(grid.squares[0].type).toBe("block");
    expect(grid.squares.every((square) => square.solution === undefined)).toBe(
      true,
    );
  });

  it("round-trips through entriesFromGrid", () => {
    const entries = `.KISS${"?".repeat(19)}.`;
    const grid = gridFromEntries(weddingMini, entries);
    expect(entriesFromGrid(grid)).toBe(entries);
  });
});
