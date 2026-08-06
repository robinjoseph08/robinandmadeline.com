// The authorable crossword puzzle format and its bridge to the solver's
// GridModel. A puzzle is plain JSON-shaped data: one grid and answer string,
// an ordered subset of the supported difficulties, and one clue set for each
// offered difficulty (same answers, different clue text). See puzzle-data.ts,
// puzzle-data-full.ts, and puzzle-data-proposal.ts for live examples, and
// puzzles.ts for the slug registry that routes to them.

import {
  GameDifficultyEasy,
  GameDifficultyHard,
  GameDifficultyMedium,
  type GameDifficulty,
} from "@/types/generated/models";

import { parseClueReferences } from "./clueReferences";
import { generateGridModel } from "./helpers";
import type { Direction, GridModel } from "./types";

function defineAllDifficulties<const D extends readonly GameDifficulty[]>(
  difficulties: D &
    ([GameDifficulty] extends [D[number]]
      ? unknown
      : readonly ["missing generated GameDifficulty"]),
): D {
  return difficulties;
}

export const DIFFICULTIES = defineAllDifficulties([
  GameDifficultyEasy,
  GameDifficultyMedium,
  GameDifficultyHard,
] as const);

export type Difficulty = GameDifficulty;

/** A puzzle must offer at least one difficulty, easiest first. */
export type PuzzleDifficulties = readonly [Difficulty, ...Difficulty[]];

/** Guest-facing labels, shared by the dialogs, menus, and leaderboard. */
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

/** The easier of two difficulties, mirroring the server's easiest-seen rule. */
export function easierDifficulty(a: Difficulty, b: Difficulty): Difficulty {
  return DIFFICULTIES.indexOf(a) <= DIFFICULTIES.indexOf(b) ? a : b;
}

/** Clue text keyed by clue number rendered as a string (e.g. { "1": "..." }). */
export interface ClueSet {
  across: Record<string, string>;
  down: Record<string, string>;
}

export interface PuzzleCell {
  row: number;
  col: number;
}

export interface ProposalCelebration {
  kind: "proposal";
  /** Accessible text represented by the animated cells. */
  message: string;
  /** Solved cells extracted in reading order; blocks represent spaces. */
  cells: PuzzleCell[];
  /** Cell counts for the compact, multi-line arrangement on narrow screens. */
  compactLineLengths: number[];
}

export interface CrosswordPuzzle {
  /** Stable identifier, used to key saved progress in localStorage. */
  id: string;
  title: string;
  width: number;
  height: number;
  /** Difficulties this puzzle offers, ordered from easiest to hardest. */
  difficulties: PuzzleDifficulties;
  /**
   * One character per square in reading order: an uppercase answer letter,
   * or "." for a block.
   */
  solution: string;
  /** Clue sets for the offered difficulties; all share the grid and answers. */
  clues: Partial<Record<Difficulty, ClueSet>>;
  /** Optional solve treatment owned by this puzzle definition. */
  celebration?: ProposalCelebration;
}

type PuzzleDefinition<D extends PuzzleDifficulties> = Omit<
  CrosswordPuzzle,
  "difficulties" | "clues"
> & {
  difficulties: D;
  clues: { [K in D[number]]: ClueSet } & Partial<
    Record<Exclude<Difficulty, D[number]>, never>
  >;
};

/**
 * Define a shipped puzzle while keeping its difficulty list and clue-set keys
 * tied together at compile time. Runtime validation still checks clue numbers
 * and protects dynamically loaded or hand-edited data.
 */
export function definePuzzle<const D extends PuzzleDifficulties>(
  puzzle: PuzzleDefinition<D>,
): PuzzleDefinition<D> {
  return puzzle;
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

  if (puzzle.difficulties.length === 0) {
    problems.push("puzzle must offer at least one difficulty");
  }
  if (new Set(puzzle.difficulties).size !== puzzle.difficulties.length) {
    problems.push("puzzle difficulties must not contain duplicates");
  }
  const orderedDifficulties = [...puzzle.difficulties].sort(
    (a, b) => DIFFICULTIES.indexOf(a) - DIFFICULTIES.indexOf(b),
  );
  if (
    puzzle.difficulties.some(
      (difficulty, index) => difficulty !== orderedDifficulties[index],
    )
  ) {
    problems.push("puzzle difficulties must be ordered easiest to hardest");
  }
  for (const difficulty of puzzle.difficulties) {
    if (!DIFFICULTIES.includes(difficulty)) {
      problems.push(`unknown puzzle difficulty "${difficulty}"`);
    }
  }
  for (const key of Object.keys(puzzle.clues)) {
    if (!DIFFICULTIES.includes(key as Difficulty)) {
      problems.push(`puzzle has clues for unknown difficulty "${key}"`);
      continue;
    }
    const difficulty = key as Difficulty;
    if (!puzzle.difficulties.includes(difficulty)) {
      problems.push(
        `puzzle has clues for unavailable difficulty "${difficulty}"`,
      );
    }
  }

  // Compute the words the grid actually contains, then require every offered
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

  for (const difficulty of puzzle.difficulties) {
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
        const clue = clueSet[direction]?.[number];
        if (!clue) {
          continue;
        }
        for (const reference of parseClueReferences(clue)) {
          if (!wordNumbers[reference.direction].has(reference.number)) {
            problems.push(
              `${difficulty} clue ${number} ${direction} references ${reference.number} ${reference.direction}, but the grid has no such word`,
            );
          }
        }
      }
    }
  }

  if (puzzle.celebration) {
    const compactCellCount = puzzle.celebration.compactLineLengths.reduce(
      (total, length) => total + length,
      0,
    );
    if (
      puzzle.celebration.compactLineLengths.length === 0 ||
      puzzle.celebration.compactLineLengths.some(
        (length) => !Number.isInteger(length) || length <= 0,
      ) ||
      compactCellCount !== puzzle.celebration.cells.length
    ) {
      problems.push(
        "celebration compact line lengths must be positive integers that cover every celebration cell",
      );
    }

    const extracted: string[] = [];
    for (const { row, col } of puzzle.celebration.cells) {
      if (row < 0 || row >= puzzle.height || col < 0 || col >= puzzle.width) {
        problems.push(
          `celebration cell at row ${row}, column ${col} is outside the grid`,
        );
        continue;
      }
      extracted.push(puzzle.solution[row * puzzle.width + col]);
    }
    const message = extracted.join("").replace(/\.+/g, " ").trim();
    if (message !== puzzle.celebration.message) {
      problems.push(
        `celebration cells spell "${message}", expected "${puzzle.celebration.message}"`,
      );
    }
  }

  return problems;
}
