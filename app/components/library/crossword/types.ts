// Core grid types for the crossword solver, vendored from
// github.com/crisscrosscx/solve (app/components/library/Grid/types.ts).

export type Direction = "across" | "down";

export interface Selection {
  col: number;
  row: number;
  direction: Direction;
}

export const inverseDirection: Record<Direction, Direction> = {
  across: "down",
  down: "across",
};

export interface SquareModel {
  number?: number;
  /** The letter the solver has entered in this square (not the answer). */
  solution?: string;
  type?: "block";
  col: number;
  row: number;
}

export interface GridModel {
  squares: SquareModel[];
  width: number;
  height: number;
  words: SquareModel[][];
  wordMap: Record<string, SquareModel[]>;
}
