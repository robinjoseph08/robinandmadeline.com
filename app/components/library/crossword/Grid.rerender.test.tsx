// Re-render guard for typing performance. Typing one letter on the 15x15
// must not re-render unrelated squares: Square is memoized and Grid passes it
// stable callbacks plus per-square primitives, so only the squares whose
// selection or content actually changed render again. Before that work, every
// keystroke re-rendered all 225 squares, which made typing feel laggy.

import { fireEvent, render, screen } from "@testing-library/react";
import { ComponentProps, memo } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Grid from "./Grid";
import { gridFromEntries } from "./puzzle";
import { weddingFull } from "./puzzle-data-full";

// Count every render of the real Square component by wrapping its module
// export. The wrapper is transparent (same props in, same markup out) and is
// memoized exactly like the real Square, so the count reflects how many
// squares actually re-render given the props Grid hands out.
const squareRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock("./Square", async () => {
  const actual = await vi.importActual<typeof import("./Square")>("./Square");
  const Inner = actual.default;
  return {
    default: memo((props: ComponentProps<typeof Inner>) => {
      squareRenders.count += 1;
      return <Inner {...props} />;
    }),
  };
});

function renderFullGrid() {
  return render(
    <Grid
      initialGrid={gridFromEntries(weddingFull)}
      solution={weddingFull.solution}
    />,
  );
}

describe("Grid re-renders while typing", () => {
  beforeEach(() => {
    squareRenders.count = 0;
  });

  it("does not re-render unrelated squares when a letter is typed", () => {
    renderFullGrid();
    const grid = screen.getByRole("application", { name: /crossword grid/i });
    const firstSquare = weddingFull.solution.startsWith(".")
      ? screen.getByTestId("crossword-square-0-1")
      : screen.getByTestId("crossword-square-0-0");

    // Selecting a square re-renders at most the selected word.
    fireEvent.mouseDown(firstSquare);
    squareRenders.count = 0;

    fireEvent.keyDown(grid, { key: "A" });

    // One keystroke touches the typed square, the next selected square, and
    // nothing else. Allow a little headroom over the theoretical 2 so a
    // harmless extra render doesn't flake the suite, while still failing
    // loudly if the grid ever regresses to re-rendering all 225 squares.
    expect(squareRenders.count).toBeLessThanOrEqual(6);
  });

  it("re-renders only the affected word when the selection moves", () => {
    renderFullGrid();

    fireEvent.mouseDown(screen.getByTestId("crossword-square-0-0"));
    squareRenders.count = 0;

    const grid = screen.getByRole("application", { name: /crossword grid/i });
    fireEvent.keyDown(grid, { key: "Tab" });

    // Jumping to the next word repaints the old word and the new word, but
    // never the whole 15x15.
    expect(squareRenders.count).toBeLessThanOrEqual(40);
  });
});
