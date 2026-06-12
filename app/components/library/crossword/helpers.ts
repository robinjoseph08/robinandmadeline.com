// Grid model construction and navigation helpers, vendored from
// github.com/crisscrosscx/solve (app/components/library/Grid/helpers.ts).
// Construct-mode helpers (rotational symmetry, .puz parsing) are omitted;
// this site only solves puzzles.

import {
  Direction,
  GridModel,
  inverseDirection,
  Selection,
  SquareModel,
} from "./types";
import { isPuzzleComplete } from "./validation";

/**
 * Build a GridModel from a data string with one character per square in
 * reading order: "." is a block, "?" is an empty square, and any other
 * character is a letter already entered in that square.
 */
export function generateGridModel(
  width: number,
  height: number,
  data?: string,
): GridModel {
  if (!data) {
    data = "?".repeat(width * height);
  }

  const grid: GridModel = {
    width,
    height,
    squares: data.split("").map((char: string, index: number) => {
      const row = Math.floor(index / width);
      const col = index % width;
      return {
        row,
        col,
        type: char === "." ? ("block" as const) : undefined,
        solution: ![".", "?"].includes(char) ? char : undefined,
      };
    }),
    words: [],
    wordMap: {},
  };

  recalculateNumbers(grid);

  return grid;
}

export function at(
  grid: GridModel,
  row: number,
  col: number,
): SquareModel | undefined {
  // Upstream compared row against width and col against height, which only
  // works for square grids; fixed here so non-square puzzles behave.
  if (row >= grid.height || row < 0) {
    return undefined;
  }
  if (col >= grid.width || col < 0) {
    return undefined;
  }
  return grid.squares[row * grid.width + col];
}

export function recalculateNumbers(grid: GridModel) {
  const words: SquareModel[][] = [];
  const wordMap: Record<string, SquareModel[]> = {};
  let number = 1;
  for (let index = 0; index < grid.squares.length; index++) {
    const square = grid.squares[index];
    if (square.type === "block") {
      // This is a block, so it won't have a number.
      square.number = undefined;
      continue;
    }
    let found = false;
    // Is this the beginning of an across word that's longer than 1 letter?
    const prevAcrossSquare = at(grid, square.row, square.col - 1);
    const nextAcrossSquare = at(grid, square.row, square.col + 1);
    if (
      (!prevAcrossSquare || prevAcrossSquare.type === "block") &&
      nextAcrossSquare &&
      nextAcrossSquare.type !== "block"
    ) {
      square.number = number++;
      const word = getWord(grid, square, "across");
      words.push(word);
      for (const s of word) {
        wordMap[`${s.row}:${s.col}:across`] = word;
      }
      found = true;
    }
    // Is this the beginning of a down word that's longer than 1 letter?
    const prevDownSquare = at(grid, square.row - 1, square.col);
    const nextDownSquare = at(grid, square.row + 1, square.col);
    if (
      (!prevDownSquare || prevDownSquare.type === "block") &&
      nextDownSquare &&
      nextDownSquare.type !== "block"
    ) {
      if (!found) {
        square.number = number++;
      }
      const word = getWord(grid, square, "down");
      words.push(word);
      for (const s of word) {
        wordMap[`${s.row}:${s.col}:down`] = word;
      }
      found = true;
    }
    if (!found) {
      // This square doesn't need a number, so we make sure to clear out any that existed.
      square.number = undefined;
    }
  }
  grid.words = words;
  grid.wordMap = wordMap;
}

function getWord(
  grid: GridModel,
  start: SquareModel,
  direction: Direction,
): SquareModel[] {
  const word: SquareModel[] = [];
  let square: SquareModel | undefined = start;
  while (square && square.type !== "block") {
    word.push(square);
    square = at(
      grid,
      direction === "across" ? square.row : square.row + 1,
      direction === "down" ? square.col : square.col + 1,
    );
  }
  return word;
}

export function areSquaresEqual(a: SquareModel, b: SquareModel): boolean {
  return a.row === b.row && a.col === b.col;
}

export function nextSelections(
  grid: GridModel,
  current: Selection[],
  movementDirection: "forward" | "backward",
): Selection[] {
  if (current.length === 0) {
    return [];
  }
  const { row, col, direction } = current[0];
  let nextSquare: SquareModel | undefined;
  let nextDirection: Direction = direction;
  const offset = movementDirection === "forward" ? 1 : -1;
  const resetCol = movementDirection === "forward" ? 0 : grid.width - 1;
  const resetRow = movementDirection === "forward" ? 0 : grid.height - 1;

  // Helper function to find next valid (non-block) square in a direction
  const findValidSquare = (
    startRow: number,
    startCol: number,
    dir: Direction,
  ): SquareModel | undefined => {
    let currentRow = startRow;
    let currentCol = startCol;

    while (
      currentRow >= 0 &&
      currentRow < grid.height &&
      currentCol >= 0 &&
      currentCol < grid.width
    ) {
      const candidate = at(grid, currentRow, currentCol);
      if (candidate && candidate.type !== "block") {
        return candidate;
      }

      // Move to next position in the specified direction
      if (dir === "across") {
        currentCol += offset;
      } else {
        currentRow += offset;
      }
    }
    return undefined;
  };

  switch (direction) {
    case "across":
      nextSquare = findValidSquare(row, col + offset, "across");
      if (!nextSquare) {
        nextSquare = findValidSquare(row + offset, resetCol, "across");
      }
      break;
    case "down":
      nextSquare = findValidSquare(row + offset, col, "down");
      if (!nextSquare) {
        nextSquare = findValidSquare(resetRow, col + offset, "down");
      }
      break;
  }
  if (!nextSquare) {
    // Nothing left in the movement direction. Wrapping around the grid only
    // makes sense going forward; backspace must never teleport to the far
    // corner and clear a letter there, so backward movement stops instead
    // (the caller treats "same square" as a no-op).
    if (movementDirection === "backward") {
      return [current[0]];
    }
    nextSquare = findValidSquare(resetRow, resetCol, direction);
    nextDirection = inverseDirection[direction];
  }
  if (!nextSquare) {
    // This shouldn't happen, but if we still can't find anything, just return the current selection.
    return [current[0]];
  }
  return [
    { row: nextSquare.row, col: nextSquare.col, direction: nextDirection },
  ];
}

export function updateSquare(
  grid: GridModel,
  squareToUpdate: SquareModel,
  update: Partial<SquareModel>,
): GridModel {
  const newGrid = {
    ...grid,
    squares: grid.squares.map((square) => ({
      ...square,
      ...(areSquaresEqual(square, squareToUpdate) ? update : {}),
    })),
  };
  recalculateNumbers(newGrid);
  return newGrid;
}

export function getSelectedWord(
  grid: GridModel,
  selections: Selection[],
): SquareModel[] | undefined {
  if (selections.length !== 1) {
    return undefined;
  }
  return grid.wordMap[
    `${selections[0].row}:${selections[0].col}:${selections[0].direction}`
  ];
}

/** All unique words running in `direction`, sorted in reading order. */
function wordsInDirection(
  grid: GridModel,
  direction: Direction,
): SquareModel[][] {
  const unique = new Map<string, SquareModel[]>();
  for (const [key, word] of Object.entries(grid.wordMap)) {
    const [, , keyDirection] = key.split(":");
    if (keyDirection === direction) {
      // Use the starting square as the unique key
      const startKey = `${word[0].row}:${word[0].col}`;
      if (!unique.has(startKey)) {
        unique.set(startKey, word);
      }
    }
  }
  return Array.from(unique.values()).sort((a, b) => {
    if (a[0].row !== b[0].row) return a[0].row - b[0].row;
    return a[0].col - b[0].col;
  });
}

export function getNextWord(
  grid: GridModel,
  currentSelection: Selection,
): Selection | undefined {
  // First, find the current word we're actually in based on the current selection direction
  const currentWordKey = `${currentSelection.row}:${currentSelection.col}:${currentSelection.direction}`;
  const currentWord = grid.wordMap[currentWordKey];

  if (!currentWord) return undefined;

  const allWordsInDirection = wordsInDirection(
    grid,
    currentSelection.direction,
  );

  // Find current word index by comparing starting positions
  const currentWordIndex = allWordsInDirection.findIndex((word) =>
    areSquaresEqual(word[0], currentWord[0]),
  );

  if (currentWordIndex === -1) return undefined;

  // Try next word in same direction
  if (currentWordIndex < allWordsInDirection.length - 1) {
    const nextWord = allWordsInDirection[currentWordIndex + 1];
    return {
      row: nextWord[0].row,
      col: nextWord[0].col,
      direction: currentSelection.direction,
    };
  }

  // If last word in direction, go to first word in opposite direction
  const oppositeDirection = inverseDirection[currentSelection.direction];
  const allWordsInOppositeDirection = wordsInDirection(grid, oppositeDirection);

  if (allWordsInOppositeDirection.length > 0) {
    const firstOppositeWord = allWordsInOppositeDirection[0];
    return {
      row: firstOppositeWord[0].row,
      col: firstOppositeWord[0].col,
      direction: oppositeDirection,
    };
  }

  return undefined;
}

export function getPreviousWord(
  grid: GridModel,
  currentSelection: Selection,
): Selection | undefined {
  // First, find the current word we're actually in based on the current selection direction
  const currentWordKey = `${currentSelection.row}:${currentSelection.col}:${currentSelection.direction}`;
  const currentWord = grid.wordMap[currentWordKey];

  if (!currentWord) return undefined;

  const allWordsInDirection = wordsInDirection(
    grid,
    currentSelection.direction,
  );

  // Find current word index by comparing starting positions
  const currentWordIndex = allWordsInDirection.findIndex((word) =>
    areSquaresEqual(word[0], currentWord[0]),
  );

  if (currentWordIndex === -1) return undefined;

  // Try previous word in same direction
  if (currentWordIndex > 0) {
    const prevWord = allWordsInDirection[currentWordIndex - 1];
    return {
      row: prevWord[0].row,
      col: prevWord[0].col,
      direction: currentSelection.direction,
    };
  }

  // If first word in direction, go to last word in opposite direction
  const oppositeDirection = inverseDirection[currentSelection.direction];
  const allWordsInOppositeDirection = wordsInDirection(grid, oppositeDirection);

  if (allWordsInOppositeDirection.length > 0) {
    const lastOppositeWord =
      allWordsInOppositeDirection[allWordsInOppositeDirection.length - 1];
    return {
      row: lastOppositeWord[0].row,
      col: lastOppositeWord[0].col,
      direction: oppositeDirection,
    };
  }

  return undefined;
}

export function isFirstLetterOfWord(
  grid: GridModel,
  selection: Selection,
): boolean {
  const word = getSelectedWord(grid, [selection]);
  if (!word) return false;

  const firstSquare = word[0];
  return firstSquare.row === selection.row && firstSquare.col === selection.col;
}

/**
 * Find the first blank (unfilled) square in the current word.
 * Returns undefined if all squares are filled or if not in a word.
 */
export function getFirstBlankInWord(
  grid: GridModel,
  selection: Selection,
): Selection | undefined {
  const word = getSelectedWord(grid, [selection]);
  if (!word) return undefined;

  const firstBlank = word.find((square) => !square.solution);
  if (!firstBlank) return undefined;

  return {
    row: firstBlank.row,
    col: firstBlank.col,
    direction: selection.direction,
  };
}

/**
 * Get the next selection within a word, optionally skipping filled squares.
 * If skipFilled is true and we would move to a filled square, keep advancing
 * until we find an unfilled square or reach the end of the word.
 * Returns undefined if we've reached the end of the word.
 */
export function getNextInWordSkippingFilled(
  grid: GridModel,
  selection: Selection,
  skipFilled: boolean,
): Selection | undefined {
  const word = getSelectedWord(grid, [selection]);
  if (!word) return undefined;

  // Find current position in word
  const currentIndex = word.findIndex(
    (square) => square.row === selection.row && square.col === selection.col,
  );
  if (currentIndex === -1) return undefined;

  // Look for next valid square
  for (let i = currentIndex + 1; i < word.length; i++) {
    const square = word[i];

    // If we're skipping filled squares, continue to next if this one is filled
    if (skipFilled && square.solution) {
      continue;
    }

    // Found a valid square
    return {
      row: square.row,
      col: square.col,
      direction: selection.direction,
    };
  }

  // Reached end of word without finding a valid square
  return undefined;
}

/**
 * Get the next word, with optional behavior to skip completed words
 * and position at the first blank square.
 *
 * If skipCompleted is true:
 * - Skips over completely filled words
 * - Positions at the first blank square of the target word
 * - If the entire grid is filled, goes to the start of the next word anyway
 *
 * If skipCompleted is false:
 * - Behaves like regular getNextWord, goes to start of next word
 */
export function getNextWordSkippingCompleted(
  grid: GridModel,
  currentSelection: Selection,
  skipCompleted: boolean,
): Selection | undefined {
  if (!skipCompleted) {
    return getNextWord(grid, currentSelection);
  }

  // Check if entire grid is complete
  const gridComplete = isPuzzleComplete(grid);

  let nextSelection = getNextWord(grid, currentSelection);
  const startingSelection = nextSelection; // Track where we started to avoid infinite loops
  let attempts = 0;
  const maxAttempts = 100; // Safety limit

  while (nextSelection && attempts < maxAttempts) {
    attempts++;

    // Get the word at this selection
    const word = getSelectedWord(grid, [nextSelection]);

    if (!word) {
      // No word found, return what we have
      return nextSelection;
    }

    // If grid is complete, or word is not complete, we found our target
    if (gridComplete || !isWordComplete(word)) {
      // Position at the first blank in the word (or start if complete/gridComplete)
      const firstBlank = getFirstBlankInWord(grid, nextSelection);
      return firstBlank || nextSelection;
    }

    // Word is complete and grid is not complete, try next word
    const nextAttempt = getNextWord(grid, nextSelection);

    // If we've wrapped around to where we started, stop
    if (
      nextAttempt &&
      startingSelection &&
      nextAttempt.row === startingSelection.row &&
      nextAttempt.col === startingSelection.col &&
      nextAttempt.direction === startingSelection.direction
    ) {
      // All words are complete, return the original next word
      return startingSelection;
    }

    nextSelection = nextAttempt;
  }

  // Safety fallback
  return nextSelection;
}

/**
 * Get the previous word, with optional behavior to skip completed words
 * and position at the first blank square.
 *
 * If skipCompleted is true:
 * - Skips over completely filled words
 * - Positions at the first blank square of the target word
 * - If the entire grid is filled, goes to the start of the previous word anyway
 *
 * If skipCompleted is false:
 * - Behaves like regular getPreviousWord, goes to start of previous word
 */
export function getPreviousWordSkippingCompleted(
  grid: GridModel,
  currentSelection: Selection,
  skipCompleted: boolean,
): Selection | undefined {
  if (!skipCompleted) {
    return getPreviousWord(grid, currentSelection);
  }

  // Check if entire grid is complete
  const gridComplete = isPuzzleComplete(grid);

  let prevSelection = getPreviousWord(grid, currentSelection);
  const startingSelection = prevSelection; // Track where we started to avoid infinite loops
  let attempts = 0;
  const maxAttempts = 100; // Safety limit

  while (prevSelection && attempts < maxAttempts) {
    attempts++;

    // Get the word at this selection
    const word = getSelectedWord(grid, [prevSelection]);

    if (!word) {
      // No word found, return what we have
      return prevSelection;
    }

    // If grid is complete, or word is not complete, we found our target
    if (gridComplete || !isWordComplete(word)) {
      // Position at the first blank in the word (or start if complete/gridComplete)
      const firstBlank = getFirstBlankInWord(grid, prevSelection);
      return firstBlank || prevSelection;
    }

    // Word is complete and grid is not complete, try previous word
    const prevAttempt = getPreviousWord(grid, prevSelection);

    // If we've wrapped around to where we started, stop
    if (
      prevAttempt &&
      startingSelection &&
      prevAttempt.row === startingSelection.row &&
      prevAttempt.col === startingSelection.col &&
      prevAttempt.direction === startingSelection.direction
    ) {
      // All words are complete, return the original previous word
      return startingSelection;
    }

    prevSelection = prevAttempt;
  }

  // Safety fallback
  return prevSelection;
}

export function isWordComplete(word: SquareModel[]): boolean {
  return word.every((square) => square.solution && square.solution !== "?");
}

export function getCompletedWords(grid: GridModel): Set<string> {
  const completedWords = new Set<string>();

  for (const [key, word] of Object.entries(grid.wordMap)) {
    if (isWordComplete(word)) {
      const [, , direction] = key.split(":");
      const wordNumber = word[0].number?.toString();
      if (wordNumber) {
        completedWords.add(`${wordNumber}:${direction}`);
      }
    }
  }

  return completedWords;
}

export function findWordByClueNumber(
  grid: GridModel,
  clueNumber: string,
  direction: Direction,
): Selection | undefined {
  // Find the word that starts with the given clue number in the specified direction
  for (const [key, word] of Object.entries(grid.wordMap)) {
    const [, , keyDirection] = key.split(":");

    if (
      keyDirection === direction &&
      word[0].number?.toString() === clueNumber
    ) {
      // Return the starting position of the word
      return {
        row: word[0].row,
        col: word[0].col,
        direction: direction,
      };
    }
  }

  return undefined;
}
