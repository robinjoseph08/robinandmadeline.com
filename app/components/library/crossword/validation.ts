// Solution checking, vendored from github.com/crisscrosscx/solve
// (app/components/library/Grid/validation.ts).

import { GridModel } from "./types";

export function validateSolution(
  grid: GridModel,
  solutionString: string,
): boolean {
  // Check if all non-block squares have user input
  for (const square of grid.squares) {
    if (square.type !== "block" && !square.solution) {
      // Puzzle is incomplete
      return false;
    }
  }

  // Compare user input against the solution string
  for (let i = 0; i < grid.squares.length; i++) {
    const square = grid.squares[i];
    const solutionChar = solutionString[i];

    if (square.type === "block") {
      // Block squares should match '.' in solution
      if (solutionChar !== ".") {
        return false;
      }
    } else {
      // Non-block squares should match their solution character
      if (square.solution !== solutionChar) {
        return false;
      }
    }
  }

  return true;
}

export function isPuzzleComplete(grid: GridModel): boolean {
  // Check if all non-block squares have been filled
  return grid.squares.every(
    (square) => square.type === "block" || square.solution,
  );
}
