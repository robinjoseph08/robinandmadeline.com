// A single crossword square, vendored from github.com/crisscrosscx/solve
// (app/components/library/Grid/Square.tsx) and adapted: solve-only props,
// wedding palette colors, and squares that scale with the grid container so
// the puzzle stays playable on small screens.
//
// The component is memoized and receives only primitives plus a stable
// callback, so a keystroke re-renders just the squares whose selection or
// content changed instead of the whole grid (225 squares on the 15x15).

import { memo, MouseEvent } from "react";

import { cn } from "@/libraries/utils";

import { SquareModel } from "./types";

interface Props {
  /** Whether this square is the cursor. */
  isSelected: boolean;
  /** Whether this square is in the selected word (but not the cursor). */
  isInSelectedWord: boolean;
  onMouseDown: (e: MouseEvent, square: SquareModel) => void;
  square: SquareModel;
}

const Square = memo(function Square({
  isSelected,
  isInSelectedWord,
  onMouseDown,
  square,
}: Props) {
  return (
    <div
      className={cn(
        "relative flex aspect-square w-full cursor-default select-none border-b border-r border-ink",
        square.col === 0 && "border-l",
        square.row === 0 && "border-t",
        // This is a block.
        square.type === "block" && "bg-ink",
        // This is the selected square.
        square.type !== "block" && isSelected && "bg-secondary",
        // This is a square that's in the same word as the selection.
        isInSelectedWord && "bg-secondary/40",
      )}
      data-testid={`crossword-square-${square.row}-${square.col}`}
      onMouseDown={(e) => onMouseDown(e, square)}
      style={{
        gridRow: `${square.row + 1} / span 1`,
        gridColumn: `${square.col + 1} / span 1`,
      }}
    >
      {/*
        The inner @container makes the square an inline-size query container,
        so the clue number and letter scale in cqw units (1cqw = 1% of the
        square's width, which equals its height since squares keep a 1:1
        aspect). Sizes stay proportional from a large 5x5 mini square down to
        a small 15x15 square on a phone, where fixed pixel font sizes were
        wrong at one extreme or the other.
      */}
      <div className="@container absolute inset-0">
        {square.number !== undefined && (
          // The 7px floor keeps numbers legible on a 15x15 at phone widths,
          // where 24cqw alone would drop below readable size.
          <span className="absolute left-[4cqw] top-[2cqw] text-[max(7px,24cqw)] leading-none">
            {square.number}
          </span>
        )}
        {square.solution !== undefined && (
          <span className="absolute inset-0 flex items-end justify-center pb-[6cqw] text-[60cqw] font-bold leading-none">
            {square.solution}
          </span>
        )}
      </div>
    </div>
  );
});

export default Square;
