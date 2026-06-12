// The interactive crossword grid, vendored from github.com/crisscrosscx/solve
// (app/components/library/Grid/index.tsx) and adapted for this site:
// solve mode only (construct mode and its lodash dependency are dropped), and
// a hidden input keeps the on-screen keyboard up on touch devices, where
// keydown events on a plain div would never summon one.

import {
  ChangeEvent,
  forwardRef,
  KeyboardEvent,
  MouseEvent,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { cn } from "@/libraries/utils";

import {
  at,
  getFirstBlankInWord,
  getNextInWordSkippingFilled,
  getNextWordSkippingCompleted,
  getPreviousWordSkippingCompleted,
  isFirstLetterOfWord,
  nextSelections,
  updateSquare,
} from "./helpers";
import {
  NAV_BACKSPACE_ACROSS_WORDS,
  NAV_JUMP_TO_FIRST_BLANK_ON_COMPLETE,
  NAV_MANUAL_WORD_ADVANCE,
  NAV_SKIP_FILLED_SQUARES,
} from "./navigationSettings";
import Square from "./Square";
import { GridModel, inverseDirection, Selection, SquareModel } from "./types";
import { isPuzzleComplete, validateSolution } from "./validation";

interface Props {
  className?: string;
  initialGrid: GridModel;
  isSolved?: boolean;
  onGridChange?: (grid: GridModel) => void;
  onSelectionChange?: (selections: Selection[]) => void;
  /** The answer string ("." for blocks), used to stop cursor advancement on a correct fill. */
  solution: string;
}

export interface GridHandle {
  setSelection: (selection: Selection) => void;
  focus: () => void;
}

// The hidden input always holds this sentinel so mobile keyboards produce an
// observable mutation for backspace (the value shrinks) as well as for
// letters (the value grows). With an empty input, deleting emits no event at
// all, which would leave backspace dead on exactly the keyboards the hidden
// input exists for.
const HIDDEN_INPUT_SENTINEL = " ";

const Grid = forwardRef<GridHandle, Props>(
  (
    {
      className,
      initialGrid,
      isSolved,
      onGridChange,
      onSelectionChange,
      solution,
    },
    ref,
  ) => {
    const [grid, setGrid] = useState<GridModel>(initialGrid);
    const [selections, setSelections] = useState<Selection[]>([]);

    // Edits lock once the grid is correct. Computed from local grid state
    // rather than relying only on the isSolved prop, which arrives a render
    // late (the parent learns of grid changes via an effect), so a fast
    // keystroke right after the winning one cannot corrupt the solved grid.
    const isLocked =
      isSolved || (isPuzzleComplete(grid) && validateSolution(grid, solution));

    const gridContainerRef = useRef<HTMLDivElement>(null);
    // The hidden input that receives focus so touch devices show a keyboard.
    const hiddenInputRef = useRef<HTMLInputElement>(null);

    // Handle focus to set initial selection if none exists. The functional
    // update matters: clicking a square focuses the hidden input, whose focus
    // event bubbles here in the same batch as the click's own selection
    // update, and this must not clobber (or double-toggle) that selection.
    const handleFocus = useCallback(() => {
      setSelections((prev) => {
        if (prev.length > 0) {
          return prev;
        }
        // Find the first non-block square for initial selection
        const firstSquare = grid.squares.find(
          (square) => square.type !== "block",
        );
        if (!firstSquare) {
          return prev;
        }
        return [
          {
            row: firstSquare.row,
            col: firstSquare.col,
            direction: "across",
          },
        ];
      });
    }, [grid.squares]);

    // Expose imperative handle for parent to set selection
    useImperativeHandle(
      ref,
      () => ({
        setSelection: (selection: Selection) => {
          setSelections([selection]);
          hiddenInputRef.current?.focus();
        },
        focus: () => {
          hiddenInputRef.current?.focus();
          handleFocus();
        },
      }),
      [handleFocus],
    );

    // Notify parent component when selection changes
    useEffect(() => {
      onSelectionChange?.(selections);
    }, [selections, onSelectionChange]);

    // Notify parent component when grid changes
    useEffect(() => {
      onGridChange?.(grid);
    }, [grid, onGridChange]);

    const handleMouseDown = (e: MouseEvent, square: SquareModel) => {
      e.stopPropagation();
      e.preventDefault();

      // Block squares can't be selected
      if (square.type === "block") {
        return;
      }

      setSelections((prev) => {
        return [
          {
            col: square.col,
            row: square.row,
            direction:
              prev[0]?.col === square.col && prev[0]?.row === square.row
                ? inverseDirection[prev[0].direction]
                : prev[0]?.direction || "across",
          },
        ];
      });

      // Focus the hidden input so typing works and mobile keyboards appear.
      // This runs after the selection update is queued, so the bubbled focus
      // handler above sees a selection and leaves it alone.
      hiddenInputRef.current?.focus();
    };

    // Enter a single character into the selected square and advance the cursor.
    const enterCharacter = useCallback(
      (key: string) => {
        if (selections.length !== 1) {
          return;
        }

        // Don't allow editing if puzzle is solved
        if (isLocked) {
          return;
        }

        const activeSquare = at(grid, selections[0].row, selections[0].col);
        if (!activeSquare) {
          return;
        }

        // Check if puzzle was complete before entering the character
        const wasComplete = isPuzzleComplete(grid);

        const updatedGrid = updateSquare(grid, activeSquare, {
          solution: key.toUpperCase(),
        });
        setGrid(updatedGrid);

        // Check if puzzle is now complete
        const isNowComplete = isPuzzleComplete(updatedGrid);

        // Don't advance cursor if:
        // 1. Puzzle just became complete (the page surfaces correct/incorrect)
        // 2. Puzzle was already complete and is now correct
        const justBecameComplete = !wasComplete && isNowComplete;
        const isNowCorrect =
          isNowComplete && validateSolution(updatedGrid, solution);

        if (justBecameComplete || isNowCorrect) {
          return;
        }

        // Try to find next square in the current word (skipping filled if enabled)
        const nextInWord = getNextInWordSkippingFilled(
          updatedGrid,
          selections[0],
          NAV_SKIP_FILLED_SQUARES,
        );

        if (nextInWord) {
          // Found a valid next square in the word, move there
          setSelections([nextInWord]);
          return;
        }

        // Reached end of word or no more valid squares in word.
        // Check if we should jump back to first blank
        if (NAV_JUMP_TO_FIRST_BLANK_ON_COMPLETE) {
          const firstBlank = getFirstBlankInWord(updatedGrid, selections[0]);
          if (firstBlank) {
            setSelections([firstBlank]);
            return;
          }
        }

        // Check if we should auto-advance to next word
        if (!NAV_MANUAL_WORD_ADVANCE) {
          const nextWord = getNextWordSkippingCompleted(
            updatedGrid,
            selections[0],
            NAV_SKIP_FILLED_SQUARES,
          );
          if (nextWord) {
            setSelections([nextWord]);
          } else {
            setSelections((prev) =>
              nextSelections(updatedGrid, prev, "forward"),
            );
          }
        }
        // If NAV_MANUAL_WORD_ADVANCE is true, stay at current position
      },
      [grid, selections, isLocked, solution],
    );

    // Clear the selected square, or move backward and clear when already empty.
    const handleBackspace = useCallback(() => {
      if (selections.length !== 1) {
        return;
      }

      // Don't allow editing if puzzle is solved
      if (isLocked) {
        return;
      }

      const currentSquare = at(grid, selections[0].row, selections[0].col);
      if (!currentSquare) {
        return;
      }

      if (currentSquare.solution) {
        // Current square is filled: clear it and stay at current position
        setGrid(updateSquare(grid, currentSquare, { solution: undefined }));
        return;
      }

      // Current square is empty: check if we should move backward.
      // If we're at the first letter of a word and NAV_BACKSPACE_ACROSS_WORDS
      // is false, don't move.
      const isFirstLetter = isFirstLetterOfWord(grid, selections[0]);
      if (isFirstLetter && !NAV_BACKSPACE_ACROSS_WORDS) {
        return;
      }

      // Move backward and clear that square
      const previousSelections = nextSelections(grid, selections, "backward");

      if (
        previousSelections.length > 0 &&
        (previousSelections[0].row !== selections[0].row ||
          previousSelections[0].col !== selections[0].col)
      ) {
        const squareToClear = at(
          grid,
          previousSelections[0].row,
          previousSelections[0].col,
        );
        if (squareToClear) {
          setGrid(updateSquare(grid, squareToClear, { solution: undefined }));
        }
        // Move selection to the previous square
        setSelections(previousSelections);
      }
      // If we couldn't find a previous square, do nothing
    }, [grid, selections, isLocked]);

    const handleKeyDown = useCallback(
      (e: KeyboardEvent) => {
        // Allow browser shortcuts (Cmd+R, Ctrl+F, etc.) to work
        if (e.metaKey || e.ctrlKey) {
          return;
        }

        if (e.key === "Escape") {
          // Escape hatch for keyboard users: blur the grid so Tab goes back
          // to moving focus around the page instead of between words.
          hiddenInputRef.current?.blur();
          gridContainerRef.current?.blur();
          return;
        }

        if (e.key === "Tab") {
          // Move to next/previous word
          if (selections.length === 1) {
            e.preventDefault();
            const nextWord = e.shiftKey
              ? getPreviousWordSkippingCompleted(
                  grid,
                  selections[0],
                  NAV_SKIP_FILLED_SQUARES,
                )
              : getNextWordSkippingCompleted(
                  grid,
                  selections[0],
                  NAV_SKIP_FILLED_SQUARES,
                );
            if (nextWord) {
              setSelections([nextWord]);
            }
          }
          return;
        }

        if (e.key === " ") {
          // Space key: toggle direction
          e.preventDefault();
          if (selections.length === 1) {
            setSelections((prev) => [
              {
                ...prev[0],
                direction: inverseDirection[prev[0].direction],
              },
            ]);
          }
          return;
        }

        if (e.key === "Backspace") {
          e.preventDefault();
          handleBackspace();
          return;
        }

        if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
        ) {
          e.preventDefault();
          // Move the selection in a certain direction.
          if (selections.length === 0) {
            // There's no selection, so don't do anything.
            return;
          }

          if (
            (["ArrowLeft", "ArrowRight"].includes(e.key) &&
              selections[0].direction !== "across") ||
            (["ArrowUp", "ArrowDown"].includes(e.key) &&
              selections[0].direction !== "down")
          ) {
            // The arrow is in the opposite direction of the current selection,
            // so we don't move yet, we just change direction.
            setSelections((prev) => [
              {
                ...prev[0],
                direction: inverseDirection[prev[0].direction],
              },
            ]);
            return;
          }

          // Simple grid-based arrow key movement
          setSelections((prev) => {
            const currentSelection = prev[0];
            let newRow = currentSelection.row;
            let newCol = currentSelection.col;

            // Calculate the direction to move
            if (e.key === "ArrowUp") {
              newRow = currentSelection.row - 1;
            } else if (e.key === "ArrowDown") {
              newRow = currentSelection.row + 1;
            } else if (e.key === "ArrowLeft") {
              newCol = currentSelection.col - 1;
            } else if (e.key === "ArrowRight") {
              newCol = currentSelection.col + 1;
            }

            // Keep searching in the same direction until we find a valid
            // square or hit the boundary
            while (
              newRow >= 0 &&
              newRow < grid.height &&
              newCol >= 0 &&
              newCol < grid.width
            ) {
              const targetSquare = at(grid, newRow, newCol);

              // If we found a non-block square, move there
              if (targetSquare && targetSquare.type !== "block") {
                return [
                  {
                    ...currentSelection,
                    row: newRow,
                    col: newCol,
                  },
                ];
              }

              // Continue searching in the same direction
              if (e.key === "ArrowUp") {
                newRow--;
              } else if (e.key === "ArrowDown") {
                newRow++;
              } else if (e.key === "ArrowLeft") {
                newCol--;
              } else if (e.key === "ArrowRight") {
                newCol++;
              }
            }

            // If we hit the boundary or couldn't find a valid square, don't move
            return prev;
          });
          return;
        }

        // Only single letters enter the grid. Anything else (digits,
        // punctuation, function keys) is left to the browser: entering it
        // would poison the saved entries string ("." is the block marker and
        // "?" the empty-square marker), and unhandled keys like F5 must keep
        // working.
        if (/^[a-zA-Z]$/.test(e.key)) {
          e.preventDefault();
          enterCharacter(e.key);
        }
      },
      [grid, selections, enterCharacter, handleBackspace],
    );

    // Some mobile keyboards don't emit usable keydown events; they only
    // mutate the input. Recover what happened from the mutation: a value
    // shorter than the sentinel means backspace deleted it, and any letter in
    // the value was typed (the sentinel is a space, so it never matches).
    // Desktop keydowns never reach here: handled keys are preventDefaulted
    // before they can mutate the input.
    const handleHiddenInputChange = (e: ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      if (value.length < HIDDEN_INPUT_SENTINEL.length) {
        handleBackspace();
        return;
      }
      const typed = value.replace(/[^a-zA-Z]/g, "").slice(-1);
      if (typed !== "") {
        enterCharacter(typed);
      }
    };

    return (
      <div
        aria-label="Crossword grid"
        className={cn("relative grid touch-manipulation", className)}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        ref={gridContainerRef}
        role="application"
        style={{
          gridTemplateColumns: `repeat(${grid.width}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${grid.height}, minmax(0, 1fr))`,
        }}
        tabIndex={0}
      >
        <input
          aria-label="Crossword answer input"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          className="absolute left-0 top-0 h-px w-px opacity-0"
          onChange={handleHiddenInputChange}
          // Keep the caret after the sentinel so backspace has something to
          // delete; focus can otherwise land at position 0.
          onFocus={(e) =>
            e.currentTarget.setSelectionRange(
              HIDDEN_INPUT_SENTINEL.length,
              HIDDEN_INPUT_SENTINEL.length,
            )
          }
          ref={hiddenInputRef}
          spellCheck={false}
          type="text"
          value={HIDDEN_INPUT_SENTINEL}
        />
        {grid.squares.map((square) => (
          <Square
            grid={grid}
            key={`${square.col}:${square.row}`}
            onMouseDown={(e) => handleMouseDown(e, square)}
            selections={selections}
            square={square}
          />
        ))}
      </div>
    );
  },
);

Grid.displayName = "Grid";

export default Grid;
