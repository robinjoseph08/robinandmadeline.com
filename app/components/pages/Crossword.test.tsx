import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import Crossword from "@/components/pages/Crossword";

// The shipped puzzle: ".KISSDANCEAPNEASPENTHARE." on a 5x5 grid with blocks
// at the first and last squares. 1-Across is KISS, starting at row 0, col 1.
const PROGRESS_KEY = "crossword:wedding-mini-v1:progress";
const SOLUTION = ".KISSDANCEAPNEASPENTHARE.";
const EMPTY_ENTRIES = SOLUTION.replace(/[A-Z]/g, "?");

/** The solution with every letter filled in except the last one (row 4, col 3). */
const ALL_BUT_LAST = `${SOLUTION.slice(0, 23)}?.`;

function gridEl() {
  return screen.getByRole("application", { name: /crossword grid/i });
}

function square(row: number, col: number) {
  return screen.getByTestId(`crossword-square-${row}-${col}`);
}

describe("Crossword", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the full grid and the easy clues by default", () => {
    render(<Crossword />);

    expect(
      screen.getByRole("heading", { name: /crossword/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId(/^crossword-square-/)).toHaveLength(25);
    // The two corner blocks from the puzzle definition.
    expect(square(0, 0)).toHaveClass("bg-ink");
    expect(square(4, 4)).toHaveClass("bg-ink");
    // Easy clue text shows by default.
    expect(
      screen.getByRole("button", { name: /1\. Smooch shared at the altar/ }),
    ).toBeInTheDocument();
  });

  it("fills letters into squares as the guest types", () => {
    render(<Crossword />);

    fireEvent.mouseDown(square(0, 1));
    fireEvent.keyDown(gridEl(), { key: "K" });
    fireEvent.keyDown(gridEl(), { key: "I" });

    expect(square(0, 1)).toHaveTextContent("K");
    expect(square(0, 2)).toHaveTextContent("I");
  });

  it("clears letters with backspace", () => {
    render(<Crossword />);

    fireEvent.mouseDown(square(0, 1));
    fireEvent.keyDown(gridEl(), { key: "K" });
    // The cursor advanced to (0,2), which is empty, so backspace moves back
    // to (0,1) and clears it.
    fireEvent.keyDown(gridEl(), { key: "Backspace" });

    expect(square(0, 1)).not.toHaveTextContent("K");
  });

  it("switches clue sets without resetting entered letters", () => {
    render(<Crossword />);

    fireEvent.mouseDown(square(0, 1));
    fireEvent.keyDown(gridEl(), { key: "K" });

    fireEvent.click(screen.getByRole("button", { name: "Medium" }));

    // The clue text changed...
    expect(
      screen.getByRole("button", {
        name: /1\. It often seals the deal at a ceremony/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /1\. Smooch shared at the altar/,
      }),
    ).not.toBeInTheDocument();
    // ...but the entered letter did not.
    expect(square(0, 1)).toHaveTextContent("K");
  });

  it("saves entered letters and difficulty to localStorage", () => {
    render(<Crossword />);

    fireEvent.mouseDown(square(0, 1));
    fireEvent.keyDown(gridEl(), { key: "K" });
    fireEvent.click(screen.getByRole("button", { name: "Hard" }));

    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY)!) as {
      entries: string;
      difficulty: string;
    };
    expect(saved.entries[1]).toBe("K");
    expect(saved.difficulty).toBe("hard");
  });

  it("restores saved letters and difficulty from localStorage", () => {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({
        entries: `.KISS${"?".repeat(19)}.`,
        difficulty: "hard",
      }),
    );

    render(<Crossword />);

    expect(square(0, 1)).toHaveTextContent("K");
    expect(square(0, 2)).toHaveTextContent("I");
    expect(square(0, 3)).toHaveTextContent("S");
    expect(square(0, 4)).toHaveTextContent("S");
    // The hard clue set comes back too.
    expect(
      screen.getByRole("button", { name: /1\. French connection\?/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hard" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("ignores saved progress that does not fit the puzzle", () => {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ entries: "XYZ", difficulty: "easy" }),
    );

    render(<Crossword />);

    expect(screen.getAllByTestId(/^crossword-square-/)).toHaveLength(25);
    expect(square(0, 1)).not.toHaveTextContent("X");
  });

  it("congratulates the guest when the last letter completes the puzzle", () => {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ entries: ALL_BUT_LAST, difficulty: "easy" }),
    );

    render(<Crossword />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    fireEvent.mouseDown(square(4, 3));
    fireEvent.keyDown(gridEl(), { key: "E" });

    expect(screen.getByRole("status")).toHaveTextContent(/you solved it/i);
  });

  it("nudges the guest when the grid is full but incorrect, and recovers", () => {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ entries: ALL_BUT_LAST, difficulty: "easy" }),
    );

    render(<Crossword />);

    fireEvent.mouseDown(square(4, 3));
    fireEvent.keyDown(gridEl(), { key: "X" });

    expect(screen.getByRole("status")).toHaveTextContent(
      /not quite right yet/i,
    );

    // Fixing the wrong letter solves the puzzle.
    fireEvent.keyDown(gridEl(), { key: "Backspace" });
    fireEvent.keyDown(gridEl(), { key: "E" });

    expect(screen.getByRole("status")).toHaveTextContent(/you solved it/i);
  });

  it("keeps an empty grid empty until the guest types", () => {
    render(<Crossword />);

    const saved = localStorage.getItem(PROGRESS_KEY);
    // Mounting saves the blank state, which must match the empty entries.
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!) as { entries: string };
    expect(parsed.entries).toBe(EMPTY_ENTRIES);
  });
});
