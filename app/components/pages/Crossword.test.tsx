// Page-level tests for the crossword's grid interactions, the start dialog,
// the de-emphasized difficulty menu, and the navigation settings. The solve
// clock, backend session reporting, completion, and leaderboard flows live
// in Crossword.session.test.tsx. Both files exercise the mini; the full
// 15x15 shares the same code path (CrosswordGame), so it only gets a render
// smoke test here.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { weddingFull } from "@/components/library/crossword/puzzle-data-full";
import { SETTINGS_STORAGE_KEY } from "@/components/library/crossword/settings";
import Crossword from "@/components/pages/Crossword";
import type { GameSession } from "@/types/generated/models";

const apiRequest = vi.fn();
vi.mock("@/libraries/api", async () => {
  const actual = await vi.importActual<object>("@/libraries/api");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  };
});

// The shipped mini: ".KISSDANCEAPNEASPENTHARE." on a 5x5 grid with blocks
// at the first and last squares. 1-Across is KISS, starting at row 0, col 1.
const PROGRESS_KEY = "crossword:wedding-mini-v1:progress";
const SOLUTION = ".KISSDANCEAPNEASPENTHARE.";
const EMPTY_ENTRIES = SOLUTION.replace(/[A-Z]/g, "?");

/** The solution with every letter filled in except the last one (row 4, col 3). */
const ALL_BUT_LAST = `${SOLUTION.slice(0, 23)}?.`;

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "sess-1",
    puzzle_id: "wedding-mini-v1",
    party_id: undefined,
    difficulty: "easy",
    elapsed_ms: 0,
    completed_at: undefined,
    display_name: undefined,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Default happy-path API: session create/update succeed, leaderboard empty. */
function mockApiRoutes() {
  apiRequest.mockImplementation(
    (path: string, options?: { method?: string; body?: unknown }) => {
      const method = options?.method ?? "GET";
      if (path === "/games/sessions" && method === "POST") {
        const body = options?.body as { difficulty: GameSession["difficulty"] };
        return Promise.resolve(makeSession({ difficulty: body.difficulty }));
      }
      if (path.startsWith("/games/sessions/") && method === "PATCH") {
        const body = options?.body as {
          difficulty?: GameSession["difficulty"];
          elapsed_ms?: number;
        };
        return Promise.resolve(
          makeSession({
            difficulty: body.difficulty ?? "easy",
            elapsed_ms: body.elapsed_ms ?? 0,
          }),
        );
      }
      if (path.startsWith("/games/leaderboard")) {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.reject(new Error(`unexpected request: ${method} ${path}`));
    },
  );
}

/** Mount the page the way the app router does, at the given puzzle slug. */
function renderCrossword(slug = "mini") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/games/${slug}`]}>
        <Routes>
          <Route Component={Crossword} path="/games/:puzzleSlug" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Flush Radix's deferred close-focus (a setTimeout(0) in its FocusScope),
 * plus any queued telemetry promises, so the grid focus and selection that
 * follow a dialog close have landed before assertions run.
 */
async function flushDialogClose() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Dismiss the start dialog with the current selections, beginning the solve. */
async function startGame() {
  fireEvent.click(screen.getByRole("button", { name: "Start solving" }));
  await flushDialogClose();
}

/** Resume a solve that mounted paused (the return-paused behavior). */
async function resumeGame() {
  const dialog = screen.getByTestId("crossword-pause-dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Resume" }));
  await flushDialogClose();
}

function gridEl() {
  return screen.getByRole("application", { name: /crossword grid/i });
}

function hiddenInput() {
  return screen.getByLabelText("Crossword answer input");
}

function square(row: number, col: number) {
  return screen.getByTestId(`crossword-square-${row}-${col}`);
}

/** Open the "more" menu and switch to the given difficulty. */
async function switchDifficulty(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  fireEvent.click(await screen.findByRole("button", { name: label }));
  await act(async () => {});
}

describe("Crossword", () => {
  beforeEach(() => {
    localStorage.clear();
    apiRequest.mockReset();
    mockApiRoutes();
  });

  describe("start dialog", () => {
    it("shows on a first visit and explains the rules", () => {
      renderCrossword();

      const dialog = screen.getByRole("dialog", { name: /ready to solve/i });
      // The leaderboard opportunity and the easiest-difficulty rule are both
      // part of the pitch.
      expect(dialog).toHaveTextContent(/post your time to the leaderboard/i);
      expect(dialog).toHaveTextContent(
        /recorded at the easiest difficulty you use/i,
      );
      // Difficulty choices, with easy preselected.
      const group = within(dialog).getByRole("group", { name: "Difficulty" });
      expect(
        within(group).getByRole("button", { name: "Easy" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        within(group).getByRole("button", { name: "Hard" }),
      ).toHaveAttribute("aria-pressed", "false");
      // The show-timer choice defaults to on.
      expect(
        within(dialog).getByRole("checkbox", { name: /show the timer/i }),
      ).toHaveAttribute("data-state", "checked");
    });

    it("starts the puzzle at the chosen difficulty and creates a session", async () => {
      renderCrossword();

      fireEvent.click(screen.getByRole("button", { name: "Medium" }));
      await startGame();

      // The dialog is gone and the medium clues are live.
      expect(
        screen.queryByRole("dialog", { name: /ready to solve/i }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", {
          name: /1\. It often seals the deal at a ceremony/,
        }),
      ).toBeInTheDocument();
      // The backend session was created with the puzzle id (not the slug)
      // and the chosen difficulty.
      expect(apiRequest).toHaveBeenCalledWith(
        "/games/sessions",
        expect.objectContaining({
          method: "POST",
          body: { puzzle_id: "wedding-mini-v1", difficulty: "medium" },
        }),
      );
    });

    it("does not save progress or create a session before the guest starts", () => {
      renderCrossword();

      expect(localStorage.getItem(PROGRESS_KEY)).toBeNull();
      expect(apiRequest).not.toHaveBeenCalled();
    });

    it("blurs the entire play area, grid and clues, behind the start dialog", () => {
      renderCrossword();

      // The whole play area (grid AND clues) sits behind one blur and is
      // inert: nothing readable, nothing focusable, no sliver peeking out.
      const playArea = screen.getByTestId("crossword-play-area");
      expect(playArea).toHaveAttribute("inert");
      expect(playArea.className).toContain("blur");
      expect(square(0, 1).closest("[inert]")).not.toBeNull();
      expect(
        screen.getByTestId("crossword-clues-across").closest("[inert]"),
      ).not.toBeNull();
    });

    it("keeps the play area obscured when dismissed, with a way back in", async () => {
      renderCrossword();

      const dialog = screen.getByRole("dialog", { name: /ready to solve/i });
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

      // The play area stays blurred and inert until the guest commits, with
      // a centered button back into the start dialog.
      const playArea = screen.getByTestId("crossword-play-area");
      expect(playArea).toHaveAttribute("inert");
      expect(playArea.className).toContain("blur");
      const overlay = screen.getByTestId("crossword-start-overlay");
      fireEvent.click(
        within(overlay).getByRole("button", { name: "Start solving" }),
      );
      await startGame();
      expect(
        screen.queryByTestId("crossword-start-overlay"),
      ).not.toBeInTheDocument();
      expect(playArea).not.toHaveAttribute("inert");
      expect(playArea.className).not.toContain("blur");
      expect(localStorage.getItem(PROGRESS_KEY)).not.toBeNull();
    });

    it("skips the dialog for a returning guest and starts paused instead", async () => {
      localStorage.setItem(
        PROGRESS_KEY,
        JSON.stringify({ entries: EMPTY_ENTRIES, difficulty: "easy" }),
      );

      renderCrossword();

      // No start dialog, but no ticking clock either: the return lands on
      // the centered pause dialog with the play area obscured behind it.
      expect(
        screen.queryByRole("dialog", { name: /ready to solve/i }),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("crossword-pause-dialog")).toBeInTheDocument();
      expect(screen.getByTestId("crossword-play-area")).toHaveAttribute(
        "inert",
      );

      // Resuming is explicit, and uncovers the grid.
      await resumeGame();
      expect(
        screen.queryByTestId("crossword-pause-dialog"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("crossword-play-area")).not.toHaveAttribute(
        "inert",
      );
      expect(gridEl()).toBeInTheDocument();
    });

    it("shows per puzzle: progress on the mini does not skip the full's dialog", () => {
      localStorage.setItem(
        PROGRESS_KEY,
        JSON.stringify({ entries: EMPTY_ENTRIES, difficulty: "easy" }),
      );

      renderCrossword("crossword");

      expect(
        screen.getByRole("dialog", { name: /ready to solve/i }),
      ).toBeInTheDocument();
    });

    it("hides the timer readout when the guest opts out, display only", async () => {
      renderCrossword();

      fireEvent.click(
        screen.getByRole("checkbox", { name: /show the timer/i }),
      );
      await startGame();

      // No readout, but the pause affordance stays available.
      expect(screen.queryByTestId("crossword-timer")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Pause timer" }),
      ).toBeInTheDocument();
      // The choice persists in the shared settings (the same value the
      // settings dialog edits). Timing itself is still recorded; the session
      // tests assert reporting is unaffected.
      const settings = JSON.parse(
        localStorage.getItem(SETTINGS_STORAGE_KEY)!,
      ) as { showTimer: boolean };
      expect(settings.showTimer).toBe(false);
    });
  });

  describe("focus", () => {
    it("selects the first open square and focuses the grid on start", async () => {
      const user = userEvent.setup();
      renderCrossword();
      await startGame();

      // The first non-block square is selected...
      expect(square(0, 1)).toHaveClass("bg-secondary");
      // ...and the grid owns focus, so typing lands immediately without a
      // click (userEvent sends keys to the focused element).
      expect(hiddenInput()).toHaveFocus();
      await user.keyboard("k");
      expect(square(0, 1)).toHaveTextContent("K");
    });

    it("keeps the prior selection when resuming a paused solve", async () => {
      const user = userEvent.setup();
      renderCrossword();
      await startGame();

      // Move the cursor mid-word, then pause and resume.
      fireEvent.mouseDown(square(1, 2));
      fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
      await resumeGame();

      // The selection survived the pause and the grid has focus again.
      expect(square(1, 2)).toHaveClass("bg-secondary");
      expect(hiddenInput()).toHaveFocus();
      await user.keyboard("n");
      expect(square(1, 2)).toHaveTextContent("N");
    });

    it("returns focus to the grid when the settings dialog closes", async () => {
      const user = userEvent.setup();
      renderCrossword();
      await startGame();

      await user.keyboard("k");
      expect(square(0, 1)).toHaveTextContent("K");

      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      const dialog = await screen.findByTestId("crossword-settings-dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      await flushDialogClose();

      // Typing works immediately: the cursor advanced to (0,2) before the
      // dialog opened and is still there.
      expect(hiddenInput()).toHaveFocus();
      await user.keyboard("i");
      expect(square(0, 2)).toHaveTextContent("I");
    });
  });

  describe("grid", () => {
    it("renders the full grid and the easy clues by default", async () => {
      renderCrossword();
      await startGame();

      expect(
        screen.getByRole("heading", { name: /the wedding mini/i }),
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

    it("renders the 15x15 puzzle at its own slug", async () => {
      renderCrossword("crossword");
      await startGame();

      expect(
        screen.getByRole("heading", { name: weddingFull.title }),
      ).toBeInTheDocument();
      expect(screen.getAllByTestId(/^crossword-square-/)).toHaveLength(225);
      // Its first easy across clue shows, proving the clue sets are wired up.
      const [number, text] = Object.entries(weddingFull.clues.easy.across).sort(
        ([a], [b]) => parseInt(a, 10) - parseInt(b, 10),
      )[0];
      expect(
        screen.getByRole("button", { name: `${number}. ${text}` }),
      ).toBeInTheDocument();
    });

    it("shows the not-found message for an unknown puzzle slug", () => {
      renderCrossword("does-not-exist");

      expect(
        screen.getByRole("heading", { name: /can't find that puzzle/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(/no crossword/i);
      expect(screen.getByRole("link", { name: /games page/i })).toHaveAttribute(
        "href",
        "/games",
      );
      expect(
        screen.queryByTestId(/^crossword-square-/),
      ).not.toBeInTheDocument();
    });

    it("sizes letters and clue numbers relative to the square", async () => {
      renderCrossword();
      await startGame();

      // Starting auto-selects the first open square, (0,1).
      fireEvent.keyDown(gridEl(), { key: "K" });

      // The square is a container query container and both spans derive their
      // font size from it (cqw units), so the letter stays proportional on any
      // grid size. A fixed pixel font would be wrong at one extreme or the
      // other, so lock the mechanism in.
      const letter = within(square(0, 1)).getByText("K");
      expect(letter.className).toContain("cqw]");
      expect(letter.parentElement?.className).toContain("@container");
      const clueNumber = within(square(0, 1)).getByText("1");
      expect(clueNumber.className).toContain("cqw]");
    });

    it("fills letters into squares as the guest types", async () => {
      renderCrossword();
      await startGame();

      // No click needed: starting selected (0,1) across.
      fireEvent.keyDown(gridEl(), { key: "K" });
      fireEvent.keyDown(gridEl(), { key: "I" });

      expect(square(0, 1)).toHaveTextContent("K");
      expect(square(0, 2)).toHaveTextContent("I");
    });

    it("clears letters with backspace", async () => {
      renderCrossword();
      await startGame();

      fireEvent.keyDown(gridEl(), { key: "K" });
      // The cursor advanced to (0,2), which is empty, so backspace moves back
      // to (0,1) and clears it.
      fireEvent.keyDown(gridEl(), { key: "Backspace" });

      expect(square(0, 1)).not.toHaveTextContent("K");
    });

    it("does nothing when backspacing past the start of the grid", async () => {
      renderCrossword();
      await startGame();

      // Put a letter at the bottom-right open square, the spot a wrap-around
      // backspace would land on.
      fireEvent.mouseDown(square(4, 3));
      fireEvent.keyDown(gridEl(), { key: "E" });

      // Backspacing from the empty first square has nowhere to go backward; it
      // must stop rather than wrap around the grid and clear that letter.
      fireEvent.mouseDown(square(0, 1));
      fireEvent.keyDown(gridEl(), { key: "Backspace" });

      expect(square(4, 3)).toHaveTextContent("E");
    });

    it("routes real keyboard input through the focused hidden input", async () => {
      const user = userEvent.setup();
      renderCrossword();
      await startGame();

      await user.click(square(0, 1));
      // userEvent sends keys to document.activeElement, so this only works if
      // clicking actually moved focus into the grid: the square's mousedown
      // calls preventDefault (suppressing native focus) and must focus the
      // hidden input itself.
      await user.keyboard("k");

      expect(square(0, 1)).toHaveTextContent("K");
    });

    it("enters letters that arrive only as input mutations, as on touch keyboards", async () => {
      renderCrossword();
      await startGame();

      fireEvent.change(hiddenInput(), { target: { value: " k" } });

      expect(square(0, 1)).toHaveTextContent("K");

      // The cursor advanced, so the next letter lands in the following square.
      fireEvent.change(hiddenInput(), { target: { value: " i" } });
      expect(square(0, 2)).toHaveTextContent("I");
    });

    it("treats the hidden input shrinking as backspace, as on touch keyboards", async () => {
      renderCrossword();
      await startGame();

      fireEvent.keyDown(gridEl(), { key: "K" });

      // Mobile backspace never emits a usable key event; deleting the sentinel
      // from the hidden input is the only observable signal.
      fireEvent.change(hiddenInput(), { target: { value: "" } });

      expect(square(0, 1)).not.toHaveTextContent("K");
    });

    it("ignores punctuation and digits so a stray keystroke cannot poison the save", async () => {
      const { unmount } = renderCrossword();
      await startGame();

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
      renderCrossword();
      expect(square(0, 1)).toHaveTextContent("K");
    });

    it("toggles typing direction when the selected square is clicked again", async () => {
      renderCrossword();
      await startGame();

      // Click a square that isn't the auto-selected (0,1): the first click
      // selects it (across), the second toggles to down.
      fireEvent.mouseDown(square(1, 1));
      fireEvent.mouseDown(square(1, 1));
      fireEvent.keyDown(gridEl(), { key: "A" });
      fireEvent.keyDown(gridEl(), { key: "P" });

      // The second letter went down the column, not across the row.
      expect(square(1, 1)).toHaveTextContent("A");
      expect(square(2, 1)).toHaveTextContent("P");
      expect(square(1, 2)).not.toHaveTextContent("P");
    });

    it("selects the first open square when the grid itself gains focus", async () => {
      renderCrossword();
      await startGame();

      fireEvent.focus(gridEl());
      fireEvent.keyDown(gridEl(), { key: "K" });

      // The first non-block square is row 0, col 1.
      expect(square(0, 1)).toHaveTextContent("K");
    });

    it("jumps to the next unfinished word with Tab", async () => {
      renderCrossword();
      await startGame();

      // Starting selected 1-Across (KISS).
      fireEvent.keyDown(gridEl(), { key: "Tab" });

      // The next across word, 5-Across (DANCE), starts at row 1, col 0.
      expect(square(1, 0)).toHaveClass("bg-secondary");
    });

    it("selects a word from its clue and highlights the active clue", async () => {
      renderCrossword();
      await startGame();

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

    it("accents the clue crossing the cursor in the other direction's list only", async () => {
      renderCrossword();
      await startGame();

      // Select 5-Across at (1,0); the down word through (1,0) is 5-Down.
      fireEvent.mouseDown(square(1, 0));

      const clueButton = (direction: string) => {
        const item = within(screen.getByTestId(`crossword-clues-${direction}`))
          .getAllByRole("listitem")
          .find((li) => li.getAttribute("data-clue-number") === "5");
        expect(item).toBeDefined();
        return within(item!).getByRole("button");
      };

      // The down list accents 5-Down as the crossing clue.
      expect(clueButton("down").className).toContain("border-l-4");
      // The across list highlights 5-Across as SELECTED, never as crossing:
      // the page must not feed the crossing number to the selected
      // direction's own list.
      expect(clueButton("across").className).toContain("bg-secondary/50");
      expect(clueButton("across").className).not.toContain("border-l-4");
    });

    it("keeps each clue list in its own bounded scroll container", async () => {
      renderCrossword();
      await startGame();

      // jsdom cannot lay out or scroll for real, so the page test pins the
      // scroll container itself; the scroll-into-view mechanics are pinned
      // with mocked geometry in ClueList.test.tsx.
      for (const direction of ["across", "down"]) {
        const list = screen.getByTestId(`crossword-clues-${direction}`);
        expect(list.className).toContain("overflow-y-auto");
        expect(list.className).toContain("max-h-");
      }
    });
  });

  describe("difficulty menu", () => {
    it("switches clue sets from the more menu without resetting letters", async () => {
      renderCrossword();
      await startGame();

      fireEvent.mouseDown(square(0, 1));
      fireEvent.keyDown(gridEl(), { key: "K" });

      await switchDifficulty("Medium");

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
      // The switch was reported, and the payload carries the easiest level
      // used so far (easy, where the solve started) rather than the current
      // one, so the server's min always converges to the local truth.
      expect(apiRequest).toHaveBeenCalledWith(
        "/games/sessions/sess-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({
            difficulty: "easy",
            completed: false,
          }),
        }),
      );
    });

    it("is not offered before the solve starts", () => {
      renderCrossword();

      expect(
        screen.queryByRole("button", { name: "More options" }),
      ).not.toBeInTheDocument();
    });

    it("saves entered letters and difficulty to localStorage", async () => {
      renderCrossword();
      await startGame();

      fireEvent.mouseDown(square(0, 1));
      fireEvent.keyDown(gridEl(), { key: "K" });
      await switchDifficulty("Hard");

      const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY)!) as {
        entries: string;
        difficulty: string;
      };
      expect(saved.entries[1]).toBe("K");
      expect(saved.difficulty).toBe("hard");
    });

    it("restores saved letters and difficulty from localStorage", async () => {
      localStorage.setItem(
        PROGRESS_KEY,
        JSON.stringify({
          entries: `.KISS${"?".repeat(19)}.`,
          difficulty: "hard",
        }),
      );

      renderCrossword();
      // A restored in-progress solve mounts paused; resume to inspect it.
      await resumeGame();

      expect(square(0, 1)).toHaveTextContent("K");
      expect(square(0, 2)).toHaveTextContent("I");
      expect(square(0, 3)).toHaveTextContent("S");
      expect(square(0, 4)).toHaveTextContent("S");
      // The hard clue set comes back too.
      expect(
        screen.getByRole("button", { name: /1\. French connection\?/ }),
      ).toBeInTheDocument();
      // The menu reflects the restored difficulty.
      fireEvent.click(screen.getByRole("button", { name: "More options" }));
      expect(
        await screen.findByRole("button", { name: "Hard" }),
      ).toHaveAttribute("aria-pressed", "true");
    });

    it("ignores saved progress that does not fit the puzzle", () => {
      localStorage.setItem(
        PROGRESS_KEY,
        JSON.stringify({ entries: "XYZ", difficulty: "easy" }),
      );

      renderCrossword();

      expect(screen.getAllByTestId(/^crossword-square-/)).toHaveLength(25);
      expect(square(0, 1)).not.toHaveTextContent("X");
    });
  });

  describe("solving outcomes", () => {
    it("celebrates a finished solve and keeps the grid locked afterward", async () => {
      localStorage.setItem(
        PROGRESS_KEY,
        JSON.stringify({ entries: ALL_BUT_LAST, difficulty: "easy" }),
      );

      renderCrossword();
      await resumeGame();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      fireEvent.mouseDown(square(4, 3));
      fireEvent.keyDown(gridEl(), { key: "E" });
      await act(async () => {});

      // The completion dialog opens; declining it is a first-class path.
      const dialog = await screen.findByTestId("crossword-completion-dialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "No thanks" }),
      );

      expect(screen.getByRole("status")).toHaveTextContent(/you solved it/i);

      // Stray keystrokes after the win must not corrupt the solved grid.
      fireEvent.keyDown(gridEl(), { key: "X" });
      fireEvent.keyDown(gridEl(), { key: "Backspace" });

      expect(square(4, 3)).toHaveTextContent("E");
      expect(screen.getByRole("status")).toHaveTextContent(/you solved it/i);
    });

    it("nudges the guest when the grid is full but incorrect, and recovers", async () => {
      localStorage.setItem(
        PROGRESS_KEY,
        JSON.stringify({ entries: ALL_BUT_LAST, difficulty: "easy" }),
      );

      renderCrossword();
      await resumeGame();

      fireEvent.mouseDown(square(4, 3));
      fireEvent.keyDown(gridEl(), { key: "X" });

      expect(screen.getByRole("status")).toHaveTextContent(
        /not quite right yet/i,
      );

      // Fixing the wrong letter solves the puzzle.
      fireEvent.keyDown(gridEl(), { key: "Backspace" });
      fireEvent.keyDown(gridEl(), { key: "E" });
      await act(async () => {});

      const dialog = await screen.findByTestId("crossword-completion-dialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "No thanks" }),
      );
      expect(screen.getByRole("status")).toHaveTextContent(/you solved it/i);
    });

    it("saves a blank grid only once the guest has started", async () => {
      renderCrossword();
      await startGame();

      const saved = localStorage.getItem(PROGRESS_KEY);
      // Starting saves the blank state, which must match the empty entries.
      expect(saved).not.toBeNull();
      const parsed = JSON.parse(saved!) as { entries: string };
      expect(parsed.entries).toBe(EMPTY_ENTRIES);
    });
  });

  describe("settings", () => {
    function seedSettings(patch: Record<string, unknown>) {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(patch));
    }

    it("space toggles typing direction by default", async () => {
      renderCrossword();
      await startGame();

      // Starting auto-selected (0,1) across.
      fireEvent.keyDown(gridEl(), { key: " " });
      fireEvent.keyDown(gridEl(), { key: "K" });
      fireEvent.keyDown(gridEl(), { key: "A" });

      // Direction flipped to down before typing.
      expect(square(0, 1)).toHaveTextContent("K");
      expect(square(1, 1)).toHaveTextContent("A");
      expect(square(0, 2)).not.toHaveTextContent("A");
    });

    it("space clears the square and moves on when configured", async () => {
      seedSettings({ spacebarBehavior: "clear" });
      renderCrossword();
      await startGame();

      fireEvent.keyDown(gridEl(), { key: "K" });
      fireEvent.keyDown(gridEl(), { key: "I" });

      // Go back to the I and clear it with space.
      fireEvent.mouseDown(square(0, 2));
      fireEvent.keyDown(gridEl(), { key: " " });

      expect(square(0, 2)).not.toHaveTextContent("I");
      // The cursor advanced to the next square in the word.
      fireEvent.keyDown(gridEl(), { key: "S" });
      expect(square(0, 3)).toHaveTextContent("S");
    });

    it("backspace stops at the word boundary when configured", async () => {
      seedSettings({ backspaceIntoPreviousWord: false });
      renderCrossword();
      await startGame();

      // Put a letter at the end of 1-Across (the square right before 5-Across
      // begins in reading order).
      fireEvent.mouseDown(square(0, 4));
      fireEvent.keyDown(gridEl(), { key: "S" });

      // Backspace on the empty first letter of 5-Across must not reach back
      // and clear it.
      fireEvent.mouseDown(square(1, 0));
      fireEvent.keyDown(gridEl(), { key: "Backspace" });

      expect(square(0, 4)).toHaveTextContent("S");
    });

    it("backspace reaches into the previous word by default", async () => {
      renderCrossword();
      await startGame();

      fireEvent.mouseDown(square(0, 4));
      fireEvent.keyDown(gridEl(), { key: "S" });

      fireEvent.mouseDown(square(1, 0));
      fireEvent.keyDown(gridEl(), { key: "Backspace" });

      expect(square(0, 4)).not.toHaveTextContent("S");
    });

    it("typing skips filled squares by default and overwrites them when disabled", async () => {
      // Default: skip.
      const first = renderCrossword();
      await startGame();
      fireEvent.mouseDown(square(0, 2));
      fireEvent.keyDown(gridEl(), { key: "I" });
      fireEvent.mouseDown(square(0, 1));
      fireEvent.keyDown(gridEl(), { key: "K" });
      fireEvent.keyDown(gridEl(), { key: "S" });
      // The S skipped over the filled (0,2) and landed at (0,3).
      expect(square(0, 3)).toHaveTextContent("S");
      first.unmount();
      localStorage.clear();
      mockApiRoutes();

      // Disabled: the cursor walks into the filled square and overwrites it.
      seedSettings({ skipFilledSquares: false });
      renderCrossword();
      await startGame();
      fireEvent.mouseDown(square(0, 2));
      fireEvent.keyDown(gridEl(), { key: "I" });
      fireEvent.mouseDown(square(0, 1));
      fireEvent.keyDown(gridEl(), { key: "K" });
      fireEvent.keyDown(gridEl(), { key: "X" });
      expect(square(0, 2)).toHaveTextContent("X");
    });

    it("jumps back to a word's first blank by default, and stays put when disabled", async () => {
      // Default: filling the last square of a word that still has an earlier
      // blank jumps the cursor back to that blank.
      const first = renderCrossword();
      await startGame();
      fireEvent.mouseDown(square(0, 2));
      for (const key of ["I", "S", "S"]) {
        fireEvent.keyDown(gridEl(), { key });
      }
      fireEvent.keyDown(gridEl(), { key: "K" });
      // The K landed back on the skipped first square of KISS.
      expect(square(0, 1)).toHaveTextContent("K");
      first.unmount();
      localStorage.clear();
      mockApiRoutes();

      seedSettings({ jumpBackToFirstBlank: false });
      renderCrossword();
      await startGame();
      fireEvent.mouseDown(square(0, 2));
      for (const key of ["I", "S", "S"]) {
        fireEvent.keyDown(gridEl(), { key });
      }
      fireEvent.keyDown(gridEl(), { key: "K" });
      // The cursor stayed at the end of the word, so the K overwrote the
      // last square instead of jumping back.
      expect(square(0, 4)).toHaveTextContent("K");
      expect(square(0, 1)).not.toHaveTextContent("K");
    });

    it("stays at the end of a finished word by default, and jumps to the next clue when configured", async () => {
      // Default: manual advance, the cursor stays put after finishing KISS.
      // Starting auto-selects (0,1) across, the start of KISS.
      const first = renderCrossword();
      await startGame();
      for (const key of ["K", "I", "S", "S"]) {
        fireEvent.keyDown(gridEl(), { key });
      }
      fireEvent.keyDown(gridEl(), { key: "X" });
      // The X overwrote the last square instead of starting the next word.
      expect(square(0, 4)).toHaveTextContent("X");
      expect(square(1, 0)).not.toHaveTextContent("X");
      first.unmount();
      localStorage.clear();
      mockApiRoutes();

      seedSettings({ jumpToNextClue: true });
      renderCrossword();
      await startGame();
      for (const key of ["K", "I", "S", "S"]) {
        fireEvent.keyDown(gridEl(), { key });
      }
      fireEvent.keyDown(gridEl(), { key: "D" });
      // Finishing KISS advanced to 5-Across, so the D starts DANCE.
      expect(square(1, 0)).toHaveTextContent("D");
    });

    it("arrow keys stay in place after flipping direction by default, and move when configured", async () => {
      // Default: ArrowDown on an across selection only flips the direction.
      // Starting auto-selects (0,1) across.
      const first = renderCrossword();
      await startGame();
      fireEvent.keyDown(gridEl(), { key: "ArrowDown" });
      fireEvent.keyDown(gridEl(), { key: "K" });
      expect(square(0, 1)).toHaveTextContent("K");
      first.unmount();
      localStorage.clear();
      mockApiRoutes();

      seedSettings({ arrowKeyAfterDirectionChange: "move" });
      renderCrossword();
      await startGame();
      fireEvent.keyDown(gridEl(), { key: "ArrowDown" });
      fireEvent.keyDown(gridEl(), { key: "A" });
      // The flip also moved one square down, so the A landed at (1,1).
      expect(square(1, 1)).toHaveTextContent("A");
      expect(square(0, 1)).not.toHaveTextContent("A");
    });

    it("persists changes from the settings dialog and restores them on reload", async () => {
      const { unmount } = renderCrossword();
      await startGame();

      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      const dialog = await screen.findByTestId("crossword-settings-dialog");
      fireEvent.click(
        within(dialog).getByRole("checkbox", { name: /skip over filled/i }),
      );
      await act(async () => {});

      const stored = JSON.parse(
        localStorage.getItem(SETTINGS_STORAGE_KEY)!,
      ) as { skipFilledSquares: boolean };
      expect(stored.skipFilledSquares).toBe(false);

      // A fresh mount reads the stored settings back into the dialog. The
      // remount restores the in-progress solve paused, so resume first.
      unmount();
      renderCrossword();
      await resumeGame();
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      const reopened = await screen.findByTestId("crossword-settings-dialog");
      expect(
        within(reopened).getByRole("checkbox", { name: /skip over filled/i }),
      ).toHaveAttribute("data-state", "unchecked");
      expect(
        within(reopened).getByRole("checkbox", { name: /show the timer/i }),
      ).toHaveAttribute("data-state", "checked");
    });
  });
});
