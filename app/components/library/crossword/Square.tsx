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
      <div className="absolute flex h-full w-full flex-col p-[1px]">
        <span className="text-[10px] leading-none">
          {square.number !== undefined ? square.number : <>&nbsp;</>}
        </span>
        {square.solution !== undefined && (
          <span className="w-full grow text-center text-xl font-bold sm:text-2xl">
            {square.solution}
          </span>
        )}
      </div>
    </div>
  );
};

export default Square;
