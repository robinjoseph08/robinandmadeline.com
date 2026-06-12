// A single crossword square, vendored from github.com/crisscrosscx/solve
// (app/components/library/Grid/Square.tsx) and adapted: solve-only props,
// wedding palette colors, and squares that scale with the grid container so
// the puzzle stays playable on small screens.

import { MouseEventHandler } from "react";

import { cn } from "@/libraries/utils";

import { getSelectedWord } from "./helpers";
import { GridModel, Selection, SquareModel } from "./types";

function isSelectedSquare(
  selections: Selection[],
  square: SquareModel,
): boolean {
  return (
    selections.length === 1 &&
    selections[0].col === square.col &&
    selections[0].row === square.row
  );
}

interface Props {
  grid: GridModel;
  onMouseDown: MouseEventHandler;
  selections: Selection[];
  square: SquareModel;
}

const Square = ({ grid, onMouseDown, selections, square }: Props) => {
  const selectedWord = getSelectedWord(grid, selections);

  return (
    <div
      className={cn(
        "relative flex aspect-square w-full cursor-default select-none border-b border-r border-ink",
        square.col === 0 && "border-l",
        square.row === 0 && "border-t",
        // This is a block.
        square.type === "block" && "bg-ink",
        // This is the selected square.
        square.type !== "block" &&
          isSelectedSquare(selections, square) &&
          "bg-secondary",
        // This is a square that's in the same word as the selection.
        selectedWord &&
          !isSelectedSquare(selections, square) &&
          selectedWord.includes(square) &&
          "bg-secondary/40",
      )}
      data-testid={`crossword-square-${square.row}-${square.col}`}
      onMouseDown={onMouseDown}
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
};

export default Square;
