import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

function hiddenInput() {
  return screen.getByLabelText("Crossword answer input");
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
    // Clue numbers render inside their squares so clues map to words.
    expect(square(0, 1)).toHaveTextContent("1");
    expect(square(1, 0)).toHaveTextContent("5");
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

  it("routes real keyboard input through the focused hidden input", async () => {
    const user = userEvent.setup();
    render(<Crossword />);

    await user.click(square(0, 1));
    // userEvent sends keys to document.activeElement, so this only works if
    // clicking actually moved focus into the grid: the square's mousedown
    // calls preventDefault (suppressing native focus) and must focus the
    // hidden input itself.
    await user.keyboard("k");

    expect(square(0, 1)).toHaveTextContent("K");
  });

  it("enters letters that arrive only as input mutations, as on touch keyboards", () => {
    render(<Crossword />);

    fireEvent.mouseDown(square(0, 1));
    fireEvent.change(hiddenInput(), { target: { value: " k" } });

    expect(square(0, 1)).toHaveTextContent("K");

    // The cursor advanced, so the next letter lands in the following square.
    fireEvent.change(hiddenInput(), { target: { value: " i" } });
    expect(square(0, 2)).toHaveTextContent("I");
  });

  it("treats the hidden input shrinking as backspace, as on touch keyboards", () => {
    render(<Crossword />);

    fireEvent.mouseDown(square(0, 1));
    fireEvent.keyDown(gridEl(), { key: "K" });

    // Mobile backspace never emits a usable key event; deleting the sentinel
    // from the hidden input is the only observable signal.
    fireEvent.change(hiddenInput(), { target: { value: "" } });

    expect(square(0, 1)).not.toHaveTextContent("K");
  });

  it("ignores punctuation and digits so a stray keystroke cannot poison the save", () => {
    const { unmount } = render(<Crossword />);

    fireEvent.mouseDown(square(0, 1));
    fireEvent.keyDown(gridEl(), { key: "K" });
    fireEvent.keyDown(gridEl(), { key: "." });
    fireEvent.keyDown(gridEl(), { key: "1" });

    // Neither character entered the grid or moved the cursor; "." in
    // particular is the block marker in the entries format, and saving it
    // would invalidate the whole save.
    const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY)!) as {
      entries: string;
    };
    expect(saved.entries).toBe(`.K${"?".repeat(22)}.`);

    // The save still fits the puzzle, so the K survives a reload.
    unmount();
    render(<Crossword />);
    expect(square(0, 1)).toHaveTextContent("K");
  });

  it("toggles typing direction when the selected square is clicked again", () => {
    render(<Crossword />);

    fireEvent.mouseDown(square(0, 1));
    fireEvent.mouseDown(square(0, 1));
    fireEvent.keyDown(gridEl(), { key: "K" });
    fireEvent.keyDown(gridEl(), { key: "A" });

    // The second letter went down the column (1-Down), not across the row.
    expect(square(1, 1)).toHaveTextContent("A");
    expect(square(0, 2)).not.toHaveTextContent("A");
  });

  it("selects the first open square when the grid itself gains focus", () => {
    render(<Crossword />);

    fireEvent.focus(gridEl());
    fireEvent.keyDown(gridEl(), { key: "K" });

    // The first non-block square is row 0, col 1.
    expect(square(0, 1)).toHaveTextContent("K");
  });

  it("jumps to the next unfinished word with Tab", () => {
    render(<Crossword />);

    fireEvent.mouseDown(square(0, 1)); // 1-Across, KISS
    fireEvent.keyDown(gridEl(), { key: "Tab" });

    // The next across word, 5-Across (DANCE), starts at row 1, col 0.
    expect(square(1, 0)).toHaveClass("bg-secondary");
  });

  it("selects a word from its clue and highlights the active clue", () => {
    render(<Crossword />);

    const clue = screen.getByRole("button", {
      name: /5\. The couple's first one is a reception highlight/,
    });
    fireEvent.click(clue);

    // 5-Across (DANCE) starts at row 1, col 0.
    expect(square(1, 0)).toHaveClass("bg-secondary");
    expect(clue).toHaveClass("bg-secondary/50");

    // Typing lands at the start of the chosen word.
    fireEvent.keyDown(gridEl(), { key: "D" });
    expect(square(1, 0)).toHaveTextContent("D");
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

  it("locks the grid after it is solved", () => {
    localStorage.setItem(
      PROGRESS_KEY,
      JSON.stringify({ entries: ALL_BUT_LAST, difficulty: "easy" }),
    );

    render(<Crossword />);
    fireEvent.mouseDown(square(4, 3));
    fireEvent.keyDown(gridEl(), { key: "E" });
    expect(screen.getByRole("status")).toHaveTextContent(/you solved it/i);

    // Stray keystrokes after the win must not corrupt the solved grid.
    fireEvent.keyDown(gridEl(), { key: "X" });
    fireEvent.keyDown(gridEl(), { key: "Backspace" });

    expect(square(4, 3)).toHaveTextContent("E");
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
