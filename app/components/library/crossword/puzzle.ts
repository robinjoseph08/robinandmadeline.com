// The authorable crossword puzzle format and its bridge to the solver's
// GridModel. A puzzle is plain JSON-shaped data: one grid and answer string
// shared by every difficulty, plus one clue set per difficulty (same answers,
// different clue text). See puzzle-data.ts and puzzle-data-full.ts for the
// live examples, and puzzles.ts for the slug registry that routes to them.

import { generateGridModel } from "./helpers";
import type { Direction, GridModel } from "./types";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];

/** Clue text keyed by clue number rendered as a string (e.g. { "1": "..." }). */
export interface ClueSet {
  across: Record<string, string>;
  down: Record<string, string>;
}

export interface CrosswordPuzzle {
  /** Stable identifier, used to key saved progress in localStorage. */
  id: string;
  title: string;
  width: number;
  height: number;
  /**
   * One character per square in reading order: an uppercase answer letter,
   * or "." for a block.
   */
  solution: string;
  /** One clue set per difficulty; all difficulties share the grid and answers. */
  clues: Record<Difficulty, ClueSet>;
}

/**
 * A solver's in-progress entries as one character per square in reading
 * order: "." for a block, "?" for an empty square, or the entered letter.
 * This matches generateGridModel's data string format.
 */
export function entriesFromGrid(grid: GridModel): string {
  return grid.squares
    .map((square) => (square.type === "block" ? "." : (square.solution ?? "?")))
    .join("");
}

/**
 * Build the solver's grid for a puzzle, optionally restoring saved entries.
 * Entries that don't fit the puzzle (wrong length, or blocks in different
 * places) are ignored so a stale save can never corrupt the grid shape, and
 * characters this app would never write (a save only contains "A"-"Z", ".",
 * and "?") restore as empty squares rather than as junk content.
 */
export function gridFromEntries(
  puzzle: CrosswordPuzzle,
  entries?: string | null,
): GridModel {
  const blank = puzzle.solution.replace(/[^.]/g, "?");
  let data = blank;
  if (
    entries &&
    entries.length === blank.length &&
    entries.split("").every((char, i) => (char === ".") === (blank[i] === "."))
  ) {
    data = entries.replace(/[^A-Z.?]/g, "?");
  }
  return generateGridModel(puzzle.width, puzzle.height, data);
}

/**
 * Check a puzzle definition for authoring mistakes. Returns a list of
 * problems; an empty list means the puzzle is valid. The shipped puzzle is
 * held to this in a unit test, so a bad edit fails CI rather than guests.
 */
export function validatePuzzle(puzzle: CrosswordPuzzle): string[] {
  const problems: string[] = [];

  if (puzzle.id === "") {
    problems.push("puzzle id must not be empty");
  }
  if (!Number.isInteger(puzzle.width) || puzzle.width <= 0) {
    problems.push(`width must be a positive integer, got ${puzzle.width}`);
  }
  if (!Number.isInteger(puzzle.height) || puzzle.height <= 0) {
    problems.push(`height must be a positive integer, got ${puzzle.height}`);
  }
  if (puzzle.solution.length !== puzzle.width * puzzle.height) {
    problems.push(
      `solution must have ${puzzle.width * puzzle.height} characters (width x height), got ${puzzle.solution.length}`,
    );
    return problems;
  }
  if (!/^[A-Z.]+$/.test(puzzle.solution)) {
    problems.push(
      "solution may only contain uppercase letters and '.' for blocks",
    );
    return problems;
  }

  // Compute the words the grid actually contains, then require every
  // difficulty's clue sets to cover exactly those words.
  const grid = generateGridModel(puzzle.width, puzzle.height, puzzle.solution);

  // A square that belongs to no word (blocks or edges on all four sides)
  // can never be clued, so the puzzle would be impossible to solve from the
  // clues even though every clued word is fillable.
  for (const square of grid.squares) {
    if (
      square.type !== "block" &&
      !grid.wordMap[`${square.row}:${square.col}:across`] &&
      !grid.wordMap[`${square.row}:${square.col}:down`]
    ) {
      problems.push(
        `the square at row ${square.row}, column ${square.col} belongs to no across or down word, so it can never be clued`,
      );
    }
  }

  const wordNumbers: Record<Direction, Set<string>> = {
    across: new Set(),
    down: new Set(),
  };
  for (const [key, word] of Object.entries(grid.wordMap)) {
    const direction = key.split(":")[2] as Direction;
    const number = word[0].number;
    if (number !== undefined) {
      wordNumbers[direction].add(number.toString());
    }
  }

  for (const difficulty of DIFFICULTIES) {
    const clueSet = puzzle.clues[difficulty];
    if (!clueSet) {
      problems.push(`missing clue set for difficulty "${difficulty}"`);
      continue;
    }
    for (const direction of ["across", "down"] as const) {
      const clueNumbers = new Set(Object.keys(clueSet[direction] ?? {}));
      for (const number of wordNumbers[direction]) {
        if (!clueNumbers.has(number)) {
          problems.push(
            `${difficulty} is missing a clue for ${number} ${direction}`,
          );
        }
      }
      for (const number of clueNumbers) {
        if (!wordNumbers[direction].has(number)) {
          problems.push(
            `${difficulty} has a clue for ${number} ${direction}, but the grid has no such word`,
          );
        }
      }
    }
  }

  return problems;
}
