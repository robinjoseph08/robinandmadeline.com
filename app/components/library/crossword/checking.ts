import { recalculateNumbers } from "./helpers";
import type { GridModel, SquareModel } from "./types";

export type CheckScope = "square" | "word" | "grid";

export interface CheckResult {
  grid: GridModel;
  evaluated: number;
}

function squareKey(square: Pick<SquareModel, "row" | "col">): string {
  return `${square.row}:${square.col}`;
}

/**
 * Check every filled square in the requested scope. Correct entries become
 * locked; incorrect entries stay editable. Empty squares reveal nothing and
 * are ignored.
 */
export function checkSquares(
  grid: GridModel,
  solution: string,
  scope: Iterable<Pick<SquareModel, "row" | "col">>,
): CheckResult {
  const requested = new Set(Array.from(scope, squareKey));
  let evaluated = 0;
  let changed = false;
  const squares = grid.squares.map((square, index) => {
    if (
      square.type === "block" ||
      square.solution === undefined ||
      !requested.has(squareKey(square))
    ) {
      return square;
    }

    evaluated++;
    const checkState =
      square.solution === solution[index] ? "correct" : "incorrect";
    if (square.checkState === checkState) {
      return square;
    }
    changed = true;
    return { ...square, checkState } as SquareModel;
  });

  if (!changed) {
    return { grid, evaluated };
  }
  const checkedGrid = { ...grid, squares };
  recalculateNumbers(checkedGrid);
  return { grid: checkedGrid, evaluated };
}

/** One compact character per square for local progress persistence. */
export function checkStatesFromGrid(grid: GridModel): string {
  return grid.squares
    .map((square) => {
      if (square.type === "block") return ".";
      if (square.checkState === "correct") return "c";
      if (square.checkState === "incorrect") return "i";
      return "?";
    })
    .join("");
}

/**
 * Restore only check states that still agree with the saved entry and puzzle
 * answer. A malformed or stale marker is dropped rather than locking a wrong
 * letter.
 */
export function restoreCheckStates(
  grid: GridModel,
  solution: string,
  saved?: string,
): GridModel {
  if (
    !saved ||
    saved.length !== grid.squares.length ||
    !/^[.ci?]+$/.test(saved) ||
    grid.squares.some(
      (square, index) => (square.type === "block") !== (saved[index] === "."),
    )
  ) {
    return grid;
  }

  let changed = false;
  const squares = grid.squares.map((square, index) => {
    const marker = saved[index];
    const checkState =
      marker === "c" && square.solution === solution[index]
        ? "correct"
        : marker === "i" &&
            square.solution !== undefined &&
            square.solution !== solution[index]
          ? "incorrect"
          : undefined;
    if (checkState === undefined) {
      return square;
    }
    changed = true;
    return { ...square, checkState } as SquareModel;
  });

  if (!changed) {
    return grid;
  }
  const restored = { ...grid, squares };
  recalculateNumbers(restored);
  return restored;
}
