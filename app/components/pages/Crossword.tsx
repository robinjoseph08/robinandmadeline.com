import { useQueryClient } from "@tanstack/react-query";
import {
  Grid3X3,
  List,
  MoreHorizontal,
  Pause,
  RotateCcw,
  Settings as SettingsIcon,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import AllCluesView, {
  AllCluesViewHandle,
} from "@/components/library/crossword/AllCluesView";
import ClueList from "@/components/library/crossword/ClueList";
import {
  parseClueReferences,
  type ClueReference,
} from "@/components/library/crossword/clueReferences";
import CompletionDialog from "@/components/library/crossword/CompletionDialog";
import Grid, { GridHandle } from "@/components/library/crossword/Grid";
import {
  findWordByClueNumber,
  getCompletedWords,
  getFirstBlankInWord,
  getNextWord,
  getPreviousWord,
  getSelectedWord,
} from "@/components/library/crossword/helpers";
import IncorrectGridDialog from "@/components/library/crossword/IncorrectGridDialog";
import LeaderboardDialog from "@/components/library/crossword/LeaderboardDialog";
import MobileSolveDock from "@/components/library/crossword/MobileSolveDock";
import PauseDialog from "@/components/library/crossword/PauseDialog";
import {
  clearProgress,
  loadProgress,
  saveProgress,
} from "@/components/library/crossword/progress";
import ProposalCelebrationDialog from "@/components/library/crossword/ProposalCelebrationDialog";
import {
  CrosswordPuzzle,
  Difficulty,
  DIFFICULTY_LABELS,
  entriesFromGrid,
  gridFromEntries,
} from "@/components/library/crossword/puzzle";
import { getPuzzleBySlug } from "@/components/library/crossword/puzzles";
import { loadSessionRecord } from "@/components/library/crossword/session";
import {
  CrosswordSettings,
  loadSettings,
  saveSettings,
} from "@/components/library/crossword/settings";
import SettingsDialog from "@/components/library/crossword/SettingsDialog";
import StartDialog from "@/components/library/crossword/StartDialog";
import {
  Direction,
  GridModel,
  inverseDirection,
  Selection,
} from "@/components/library/crossword/types";
import useCustomKeyboard from "@/components/library/crossword/useCustomKeyboard";
import { useSolveSession } from "@/components/library/crossword/useSolveSession";
import {
  isPuzzleComplete,
  validateSolution,
} from "@/components/library/crossword/validation";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { QueryKey, useLeaderboard } from "@/hooks/queries/games";
import { usePartyRSVPs } from "@/hooks/queries/rsvp";
import { usePageTitle } from "@/hooks/usePageTitle";
import { formatDuration } from "@/libraries/format";
import { readGuestToken } from "@/libraries/guest-api";
import { cn } from "@/libraries/utils";

/**
 * The crossword page behind /games/:puzzleSlug (/games/mini is the 5x5,
 * /games/crossword the full 15x15). The slug resolves against the puzzle
 * registry; an unknown slug gets the same friendly not-found treatment as a
 * bad info-collection link. The `key` on the game forces a full remount when
 * the slug changes, so navigating between puzzles never carries one grid's
 * state into the other.
 */
export default function Crossword() {
  const { puzzleSlug = "" } = useParams();
  const puzzle = getPuzzleBySlug(puzzleSlug);
  const [resetGeneration, setResetGeneration] = useState(0);
  usePageTitle(puzzle?.title);

  if (!puzzle) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <h1 className="text-3xl font-bold">Hmm, we can't find that puzzle</h1>
        <p className="mt-3 text-muted-foreground" role="alert">
          There's no crossword at this address. Head back to{" "}
          <Link className="underline" to="/games">
            the games page
          </Link>{" "}
          to find one.
        </p>
      </section>
    );
  }

  return (
    <CrosswordGame
      key={`${puzzle.id}:${resetGeneration}`}
      onLocalReset={() => setResetGeneration((value) => value + 1)}
      puzzle={puzzle}
    />
  );
}

/**
 * One puzzle's solve view. One grid with one set of answers; switching
 * difficulty (tucked behind the "more" menu, so the easy clues aren't a
 * standing temptation) only swaps the clue text and never touches entered
 * letters. The displayed clue set and the RECORDED difficulty are distinct: a
 * mid-solve switch tracks the easiest level used (the recorded difficulty),
 * but once the solve is done a switch is purely cosmetic, letting a finished
 * guest re-read the puzzle with other clues without disturbing their recorded
 * time. Progress persists to localStorage (keyed by puzzle id) so a guest can
 * refresh or come back later and resume; the solve clock and its best-effort
 * backend session live in useSolveSession.
 */
function CrosswordGame({
  onLocalReset,
  puzzle,
}: {
  onLocalReset: () => void;
  puzzle: CrosswordPuzzle;
}) {
  // Restore any saved progress once, at mount. After this, the grid and the
  // difficulty live in component state and are written back on every change.
  const [initial] = useState(() => {
    const saved = loadProgress(puzzle.id);
    const grid = gridFromEntries(puzzle, saved?.entries);
    const solved =
      isPuzzleComplete(grid) && validateSolution(grid, puzzle.solution);
    const savedDifficulty =
      saved && puzzle.difficulties.includes(saved.difficulty)
        ? saved.difficulty
        : undefined;
    return {
      grid,
      difficulty: savedDifficulty ?? puzzle.difficulties[0],
      celebrationAcknowledged: saved?.celebrationAcknowledged ?? false,
      hasProgress: saved !== null,
      solved,
      // A solve that predates session tracking (or whose session record was
      // cleared) has no honest time, so it must not be reported or posted.
      unreportable: solved && loadSessionRecord(puzzle.id) === null,
    };
  });
  const [settings, setSettings] = useState<CrosswordSettings>(loadSettings);
  const [difficulty, setDifficulty] = useState<Difficulty>(initial.difficulty);
  const [grid, setGrid] = useState<GridModel>(initial.grid);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [startOpen, setStartOpen] = useState(!initial.hasProgress);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [allCluesOpen, setAllCluesOpen] = useState(false);
  const [incorrectOpen, setIncorrectOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [celebrationAcknowledged, setCelebrationAcknowledged] = useState(
    initial.celebrationAcknowledged,
  );
  const [celebrationRun, setCelebrationRun] = useState<
    "initial" | "replay" | null
  >(
    initial.solved &&
      !initial.unreportable &&
      puzzle.celebration !== undefined &&
      !initial.celebrationAcknowledged
      ? "initial"
      : null,
  );
  const [celebrationGeneration, setCelebrationGeneration] = useState(0);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [difficultyMenuOpen, setDifficultyMenuOpen] = useState(false);
  const gridRef = useRef<GridHandle>(null);
  const allCluesRef = useRef<AllCluesViewHandle>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const mobileInitialScrollDoneRef = useRef(false);
  const customKeyboard = useCustomKeyboard();
  const effectiveSettings = useMemo<CrosswordSettings>(
    () => ({
      ...settings,
      jumpToNextClue: settings.jumpToNextClueExplicit
        ? settings.jumpToNextClue
        : customKeyboard,
    }),
    [customKeyboard, settings],
  );
  const incorrectFullRef = useRef(
    isPuzzleComplete(initial.grid) &&
      !validateSolution(initial.grid, puzzle.solution),
  );

  const session = useSolveSession({
    puzzleId: puzzle.id,
    availableDifficulties: puzzle.difficulties,
    initiallyStarted: initial.hasProgress,
    initialDifficulty: initial.difficulty,
    // An unreportable solve mounts finished so the clock never runs and the
    // heartbeat never mints a fresh session for it.
    initiallyFinished: initial.unreportable,
    // A restored in-progress solve mounts paused (behind the pause dialog):
    // a page load must never drop the guest into the grid with the clock
    // already ticking. Tab visibility changes during a visit still silently
    // pause and resume inside useSolveSession.
    initiallyPaused: initial.hasProgress && !initial.solved,
  });
  const {
    complete: completeSession,
    setUiPaused,
    started: sessionStarted,
  } = session;

  const gridFull = useMemo(() => isPuzzleComplete(grid), [grid]);
  const solved = useMemo(
    () => gridFull && validateSolution(grid, puzzle.solution),
    [gridFull, grid, puzzle.solution],
  );

  // Save progress only once a solve has started: the saved progress is also
  // what marks a returning guest (it skips the start dialog), so a visitor
  // who only peeked must not leave a save behind.
  useEffect(() => {
    if (!sessionStarted) {
      return;
    }
    saveProgress(puzzle.id, {
      entries: entriesFromGrid(grid),
      difficulty,
      celebrationAcknowledged,
    });
  }, [puzzle.id, grid, difficulty, celebrationAcknowledged, sessionStarted]);

  // Completion: report it once. A puzzle-specific reveal stays pending until
  // the guest explicitly advances, so a refresh during the animation reopens
  // it instead of losing the one-time message.
  const completionCelebratedRef = useRef(
    initial.solved && (!puzzle.celebration || initial.celebrationAcknowledged),
  );
  useEffect(() => {
    if (!solved || !sessionStarted) {
      return;
    }
    // A solve that predates session tracking (or whose session record was
    // cleared) has no honest time: completing it would mint a fresh server
    // session with a near-zero elapsed, so it must not be reported.
    if (initial.unreportable) {
      return;
    }
    completeSession();
    if (!completionCelebratedRef.current) {
      completionCelebratedRef.current = true;
      const frame = requestAnimationFrame(() => {
        if (puzzle.celebration) {
          setCelebrationRun("initial");
        } else {
          setCompletionOpen(true);
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [
    solved,
    sessionStarted,
    completeSession,
    initial.unreportable,
    puzzle.celebration,
  ]);

  const updateSettings = useCallback((patch: Partial<CrosswordSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const focusGrid = useCallback(() => {
    gridRef.current?.focus();
  }, []);

  const focusSolveSurface = useCallback(() => {
    if (allCluesOpen) {
      allCluesRef.current?.focusSelected();
    } else {
      focusGrid();
    }
  }, [allCluesOpen, focusGrid]);

  const handleStart = (chosen: Difficulty) => {
    setDifficulty(chosen);
    session.start(chosen);
    setStartOpen(false);
  };

  // When the start dialog closes because the solve began, focus belongs in
  // the grid (with the first open square selected, via Grid's focus handler)
  // so the guest can type immediately. A dismissal without starting keeps
  // Radix's default: the play area is still inert behind the blur.
  const handleStartCloseAutoFocus = (event: Event) => {
    if (session.started) {
      event.preventDefault();
      focusGrid();
    }
  };

  // Resuming from the pause dialog returns focus to the active solving
  // surface, preserving the current selection in either grid or clue view.
  const handlePauseCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    focusSolveSurface();
  };

  const handleIncorrectOpenChange = (open: boolean) => {
    setIncorrectOpen(open);
    setUiPaused(open);
  };

  const handleIncorrectCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    focusSolveSurface();
  };

  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open);
    setUiPaused(open);
  };

  // Closing the settings dialog returns focus to the active solving surface
  // unless the play area is inert, where focus must stay out.
  const handleSettingsCloseAutoFocus = (event: Event) => {
    if (session.started && !session.paused) {
      event.preventDefault();
      focusSolveSurface();
    }
  };

  // Switching the displayed clue set. Before completion this also reports the
  // switch so the recorded difficulty tracks the easiest level used; after
  // completion it is purely cosmetic (a finished solver may re-read the puzzle
  // with other clues for fun), so only the displayed clues change and the
  // recorded difficulty stays locked. reportDifficulty is itself a no-op once
  // finished, so the guard here is for clarity, not safety.
  const handleDifficultySwitch = (level: Difficulty) => {
    setDifficultyMenuOpen(false);
    if (level === difficulty) {
      return;
    }
    setDifficulty(level);
    if (!solved) {
      session.reportDifficulty(level);
    }
  };

  // Prefill the leaderboard name for signed-in guests from their RSVP
  // record (the party's first guest is its primary member). Fetched lazily
  // when the completion dialog opens; any failure just means no prefill.
  const isSignedIn = readGuestToken() !== null;
  const { data: partyData } = usePartyRSVPs({
    enabled: completionOpen && isSignedIn && !session.posted,
  });
  const prefillName = partyData?.guests[0]?.full_name;

  // Warm the leaderboard tab the guest will land on (their own recorded
  // difficulty) while the completion dialog is up, so the auto-handoff after
  // a post opens populated. Warmed with the session id so it shares the key
  // the dialog reads with (and so the viewer's own row comes along).
  useLeaderboard(
    puzzle.id,
    session.recordedDifficulty,
    { enabled: completionOpen && session.postable },
    session.sessionId ?? undefined,
  );

  // A successful post hands off to the leaderboard: the warm-up fetch above
  // ran before the post, so the cached board is missing the new row; refetch
  // it (the prefix sweeps every difficulty tab and both the anonymous and
  // viewer-aware variants), then swap the completion dialog for the
  // leaderboard, anchored on the solve's difficulty with the session id so
  // the guest's freshly posted row is shown and highlighted.
  const queryClient = useQueryClient();
  const handlePost = async (displayName: string) => {
    await session.postToLeaderboard(displayName);
    await queryClient.invalidateQueries({
      queryKey: [QueryKey.GameLeaderboard, puzzle.id],
    });
    setCompletionOpen(false);
    setLeaderboardOpen(true);
  };

  const handleCelebrationContinue = () => {
    if (celebrationRun === "replay") {
      setCelebrationRun(null);
      return;
    }

    setCelebrationAcknowledged(true);
    setCelebrationRun(null);
    if (session.postable) {
      setCompletionOpen(true);
    }
  };

  const handleCelebrationReplay = () => {
    setCelebrationGeneration((generation) => generation + 1);
    setCelebrationRun("replay");
  };

  const handleCelebrationCloseAutoFocus = (event: Event) => {
    event.preventDefault();
  };

  const clues = puzzle.clues[difficulty]!;
  // Two-step memo so the Set's identity only changes when its CONTENTS do:
  // the selected direction's memoized clue list then skips re-rendering on
  // keystrokes that didn't complete or un-complete a word (the other
  // direction's list still re-renders as the crossing clue changes).
  const completedWordsKey = useMemo(
    () => Array.from(getCompletedWords(grid)).sort().join("|"),
    [grid],
  );
  const completedWords = useMemo(
    () => new Set(completedWordsKey === "" ? [] : completedWordsKey.split("|")),
    [completedWordsKey],
  );
  const selectedWord = useMemo(
    () => getSelectedWord(grid, selections),
    [grid, selections],
  );
  const selectedClueNumber = selectedWord?.[0].number?.toString();
  const selectedDirection =
    selections.length === 1 ? selections[0].direction : undefined;
  const clueReferences = useMemo<ClueReference[]>(() => {
    if (!selectedDirection || !selectedClueNumber) {
      return [];
    }
    const selectedClue = clues[selectedDirection][selectedClueNumber];
    return selectedClue ? parseClueReferences(selectedClue) : [];
  }, [clues, selectedClueNumber, selectedDirection]);
  const referencedSelections = useMemo(
    () =>
      clueReferences.flatMap((reference) => {
        const selection = findWordByClueNumber(
          initial.grid,
          reference.number,
          reference.direction,
        );
        return selection ? [selection] : [];
      }),
    [clueReferences, initial.grid],
  );
  const referencedNumbers = useMemo<Record<Direction, Set<string>>>(
    () => ({
      across: new Set(
        clueReferences
          .filter(({ direction }) => direction === "across")
          .map(({ number }) => number),
      ),
      down: new Set(
        clueReferences
          .filter(({ direction }) => direction === "down")
          .map(({ number }) => number),
      ),
    }),
    [clueReferences],
  );
  // The clue crossing the cursor square in the other direction; it gets an
  // accent in its list and is kept scrolled into view, like the reference
  // solver (crisscrosscx/solve) does.
  const crossingClueNumber = useMemo(() => {
    if (selections.length !== 1) {
      return undefined;
    }
    const { row, col, direction } = selections[0];
    const crossing =
      grid.wordMap[`${row}:${col}:${inverseDirection[direction]}`];
    return crossing?.[0].number?.toString();
  }, [grid, selections]);
  const selectedClue =
    selectedDirection && selectedClueNumber
      ? clues[selectedDirection][selectedClueNumber]
      : undefined;
  const selectedSquare =
    selections.length === 1
      ? grid.squares.find(
          ({ row, col }) =>
            row === selections[0].row && col === selections[0].col,
        )
      : undefined;
  const solvingStatus =
    selectedDirection && selectedClueNumber && selectedClue && selectedSquare
      ? `${selectedClueNumber} ${selectedDirection}: ${selectedClue}. Row ${selectedSquare.row + 1}, column ${selectedSquare.col + 1}, ${selectedSquare.solution ? `letter ${selectedSquare.solution}` : "blank"}.`
      : "Select a clue, then use the keyboard to enter letters.";

  const selectAdjacentClue = useCallback(
    (movement: "previous" | "next") => {
      if (selections.length !== 1) {
        focusSolveSurface();
        return;
      }
      const nextSelection =
        movement === "next"
          ? getNextWord(grid, selections[0])
          : getPreviousWord(grid, selections[0]);
      if (nextSelection) {
        gridRef.current?.setSelection(nextSelection, {
          focus: !allCluesOpen,
        });
      }
    },
    [allCluesOpen, focusSolveSurface, grid, selections],
  );

  // Reads the live grid through a ref (synced in an effect) so the callback
  // stays referentially stable and never forces the memoized clue lists to
  // re-render by changing identity.
  const liveGridRef = useRef(grid);
  useEffect(() => {
    liveGridRef.current = grid;
  }, [grid]);
  const handleGridChange = useCallback(
    (nextGrid: GridModel) => {
      const incorrectFull =
        isPuzzleComplete(nextGrid) &&
        !validateSolution(nextGrid, puzzle.solution);
      if (!incorrectFull) {
        incorrectFullRef.current = false;
      } else if (!incorrectFullRef.current) {
        incorrectFullRef.current = true;
        setIncorrectOpen(true);
        setUiPaused(true);
      }
      if (isPuzzleComplete(nextGrid)) {
        // Clue View can solve the final square itself. Return to the grid before
        // incorrect or completion dialogs appear.
        setAllCluesOpen(false);
      }
      setGrid(nextGrid);
    },
    [puzzle.solution, setUiPaused],
  );
  const handleClueClick = useCallback(
    (number: string, direction: Direction) => {
      const liveGrid = liveGridRef.current;
      const wordSelection = findWordByClueNumber(liveGrid, number, direction);
      if (wordSelection) {
        gridRef.current?.setSelection(
          getFirstBlankInWord(liveGrid, wordSelection) ?? wordSelection,
          { focus: !allCluesOpen },
        );
      }
    },
    [allCluesOpen],
  );
  const handleAllCluesSquareClick = useCallback((selection: Selection) => {
    gridRef.current?.setSelection(selection, { focus: false });
  }, []);
  const toggleSelectedDirection = useCallback(() => {
    if (selections.length !== 1) {
      return;
    }
    const selection = selections[0];
    const direction = inverseDirection[selection.direction];
    if (!grid.wordMap[`${selection.row}:${selection.col}:${direction}`]) {
      return;
    }
    gridRef.current?.setSelection(
      { ...selection, direction },
      { focus: false },
    );
  }, [grid.wordMap, selections]);
  const enterMobileLetter = useCallback((letter: string) => {
    gridRef.current?.enterCharacter(letter);
  }, []);
  const mobileBackspace = useCallback(() => {
    gridRef.current?.backspace();
  }, []);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const desktopQuery = window.matchMedia("(min-width: 768px)");
    const handleDesktopTransition = () => {
      if (!desktopQuery.matches) {
        return;
      }
      setAllCluesOpen(false);
      if (
        session.started &&
        !session.paused &&
        !startOpen &&
        !settingsOpen &&
        !incorrectOpen &&
        !completionOpen &&
        !leaderboardOpen &&
        celebrationRun === null
      ) {
        focusGrid();
      }
    };
    desktopQuery.addEventListener("change", handleDesktopTransition);
    return () =>
      desktopQuery.removeEventListener("change", handleDesktopTransition);
  }, [
    celebrationRun,
    completionOpen,
    focusGrid,
    incorrectOpen,
    leaderboardOpen,
    session.paused,
    session.started,
    settingsOpen,
    startOpen,
  ]);

  // The 15x15 needs more horizontal room than the mini, both for the page
  // and for the grid itself, so its squares stay comfortably tappable.
  const isLargePuzzle = puzzle.width > 10;

  // The solving area is obscured before the guest starts and while they are
  // explicitly paused, NYT-style, so the clock can't be beaten by reading
  // the puzzle off the clock. The whole play area (grid AND clues) blurs,
  // and `inert` keeps keyboard focus out too.
  const obscured = !session.started || session.paused || incorrectOpen;
  const mobileDockVisible =
    customKeyboard && session.started && !solved && !obscured && !settingsOpen;

  // On mobile, align the controls bar with the top of the viewport once the
  // guest can actually solve. Waiting until the start/pause dialog closes
  // avoids the dialog's scroll lock restoring the old page position. The
  // one-shot guard prevents later dialog closes from moving the page again.
  useEffect(() => {
    if (
      !customKeyboard ||
      (typeof window.matchMedia === "function" &&
        !window.matchMedia("(max-width: 767px)").matches) ||
      !session.started ||
      session.paused ||
      startOpen ||
      mobileInitialScrollDoneRef.current
    ) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      controlsRef.current?.scrollIntoView({ block: "start" });
      mobileInitialScrollDoneRef.current = true;
    });
    return () => cancelAnimationFrame(frame);
  }, [customKeyboard, session.paused, session.started, startOpen]);

  const handleDevFill = () => {
    let finalIndex = puzzle.solution.length - 1;
    while (finalIndex >= 0 && puzzle.solution[finalIndex] === ".") {
      finalIndex--;
    }
    if (finalIndex < 0) {
      return;
    }
    const entries = `${puzzle.solution.slice(0, finalIndex)}?${puzzle.solution.slice(finalIndex + 1)}`;
    const nextGrid = gridFromEntries(puzzle, entries);
    const finalSquare = nextGrid.squares[finalIndex];
    const direction: Direction = nextGrid.wordMap[
      `${finalSquare.row}:${finalSquare.col}:across`
    ]
      ? "across"
      : "down";
    gridRef.current?.replaceGrid(nextGrid, {
      row: finalSquare.row,
      col: finalSquare.col,
      direction,
    });
  };

  const handleDevClear = () => {
    session.discardLocalRecord();
    clearProgress(puzzle.id);
    onLocalReset();
  };

  return (
    <section
      className={cn(
        "mx-auto py-4 md:py-8",
        isLargePuzzle
          ? "relative left-1/2 w-screen max-w-7xl -translate-x-1/2 bg-background md:w-[calc(100vw-2rem)]"
          : "max-w-4xl",
      )}
    >
      <h1
        className={cn(
          "text-2xl font-bold md:text-3xl",
          isLargePuzzle && "px-4 md:px-0",
        )}
      >
        {puzzle.title}
      </h1>
      <p className="mt-3 hidden text-muted-foreground md:block">
        Same answers, different clue difficulties. Your progress saves
        automatically in this browser, and the fastest solvers make the
        leaderboard.
      </p>

      {import.meta.env.DEV && !allCluesOpen && (
        <div
          className="mt-3 flex flex-wrap gap-2 rounded-md border border-dashed border-green/40 bg-complementary-1/20 p-2"
          data-testid="crossword-dev-controls"
        >
          <Button
            disabled={!session.started || solved}
            onClick={handleDevFill}
            size="sm"
            type="button"
            variant="outline"
          >
            Fill all but final square
          </Button>
          <Button
            onClick={handleDevClear}
            size="sm"
            type="button"
            variant="outline"
          >
            Clear this puzzle's saved state
          </Button>
        </div>
      )}

      <div
        aria-label="Crossword controls"
        className={cn(
          "mt-3 flex min-h-11 items-center justify-between gap-2 border-y border-line bg-surface/80 md:mt-6 md:min-h-0 md:border-0 md:bg-transparent md:px-0",
          isLargePuzzle ? "px-4" : "px-1",
        )}
        ref={controlsRef}
        role="group"
      >
        <div className="flex items-center gap-1">
          {/* A finished solve with no accumulated time (an unreportable
              restore) has nothing honest to show, so the readout hides
              rather than presenting a frozen 0:00. */}
          {settings.showTimer &&
            session.started &&
            !(session.finished && session.elapsedMs === 0) && (
              <span
                aria-label="Solve time"
                className="font-medium tabular-nums"
                data-testid="crossword-timer"
              >
                {formatDuration(session.elapsedMs)}
              </span>
            )}
          {session.started && !solved && (
            <Button
              aria-label="Pause timer"
              className="size-11 md:size-9"
              onClick={session.pause}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Pause />
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          {session.started && !solved && (
            <Button
              aria-label={
                allCluesOpen ? "Show crossword grid" : "List all clues"
              }
              aria-pressed={allCluesOpen}
              className="size-11 md:hidden"
              onClick={() => setAllCluesOpen((open) => !open)}
              size="icon"
              type="button"
              variant="ghost"
            >
              {allCluesOpen ? <Grid3X3 /> : <List />}
            </Button>
          )}
          <Button
            aria-label="Settings"
            className="size-11 md:size-9"
            onClick={() => handleSettingsOpenChange(true)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <SettingsIcon />
          </Button>
          {/* The clue-difficulty switcher stays tucked behind the "more" menu
              (the easy clues aren't a standing temptation), and stays
              reachable after the solve too: a finished guest can re-read the
              puzzle with other clues for fun. Mid-solve it reports the switch;
              afterward it only changes the displayed clues. */}
          {session.started && puzzle.difficulties.length > 1 && (
            <Popover
              onOpenChange={setDifficultyMenuOpen}
              open={difficultyMenuOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  aria-label="More options"
                  className="size-11 md:size-9"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <MoreHorizontal />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-60">
                <p className="text-sm font-medium">Clue difficulty</p>
                <div
                  aria-label="Difficulty"
                  className="mt-2 flex flex-col gap-1"
                  role="group"
                >
                  {puzzle.difficulties.map((level) => (
                    <Button
                      aria-pressed={difficulty === level}
                      className="justify-start"
                      key={level}
                      onClick={() => handleDifficultySwitch(level)}
                      size="sm"
                      type="button"
                      variant={difficulty === level ? "secondary" : "ghost"}
                    >
                      {DIFFICULTY_LABELS[level]}
                    </Button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {solved
                    ? "Re-read the puzzle with other clues. Your recorded time stays as it is."
                    : "Switch any time; your letters stay put. Your time is recorded at the easiest difficulty you use."}
                </p>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      {solved ? (
        <div className="mt-4">
          <p className="font-medium text-ink" role="status">
            You solved it
            {session.elapsedMs > 0
              ? ` in ${formatDuration(session.elapsedMs)} with the ${DIFFICULTY_LABELS[session.recordedDifficulty].toLowerCase()} clues`
              : ""}
            ! See you on the dance floor.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {/* An unreportable solve has no honest time to post (see
                initial.unreportable). */}
            {!session.posted && session.postable && !initial.unreportable && (
              <Button
                onClick={() => setCompletionOpen(true)}
                size="sm"
                type="button"
                variant="outline"
              >
                Post your time
              </Button>
            )}
            {/* The leaderboard is for finishers: it never shows mid-solve,
                only here and in the completion dialog. */}
            <Button
              onClick={() => setLeaderboardOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trophy />
              Leaderboard
            </Button>
            {puzzle.celebration && (
              <Button
                onClick={handleCelebrationReplay}
                size="sm"
                type="button"
                variant="outline"
              >
                <RotateCcw />
                Replay animation
              </Button>
            )}
          </div>
        </div>
      ) : gridFull ? (
        <p className="mt-4 px-4 text-muted-foreground md:px-0" role="status">
          The grid is full, but something is not quite right yet. Keep tweaking!
        </p>
      ) : null}

      <div
        className={cn(
          "relative md:mt-6",
          allCluesOpen ? "mt-0" : "mt-3",
          mobileDockVisible && !allCluesOpen && "mb-[17rem]",
        )}
      >
        <div
          className={cn(
            allCluesOpen ? "block md:grid" : "grid",
            "gap-8",
            isLargePuzzle
              ? "md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] xl:grid-cols-[minmax(0,36rem)_minmax(0,1fr)]"
              : "md:grid-cols-2",
            // While obscured, the entire play area (grid AND clues) blurs:
            // no sliver of puzzle peeks out at any viewport size, nothing is
            // readable, and inert keeps it non-interactive.
            obscured && "pointer-events-none select-none blur-md",
          )}
          data-testid="crossword-play-area"
          inert={obscured || undefined}
        >
          <div
            className={cn(
              "relative left-1/2 mx-auto h-fit w-screen -translate-x-1/2 md:left-auto md:w-full md:translate-x-0",
              isLargePuzzle ? "md:max-w-xl" : "md:max-w-md",
              solved && "puzzle-solved-container",
              allCluesOpen &&
                "invisible h-0 overflow-hidden md:visible md:h-fit md:overflow-visible",
            )}
          >
            <Grid
              className="w-full"
              initialGrid={initial.grid}
              isSolved={solved}
              onGridChange={handleGridChange}
              onSelectionChange={setSelections}
              ref={gridRef}
              referencedSelections={referencedSelections}
              settings={effectiveSettings}
              solution={puzzle.solution}
            />
          </div>

          <div className="hidden gap-6 md:grid md:grid-cols-1 lg:grid-cols-2">
            {(["across", "down"] as const).map((direction) => (
              <ClueList
                clues={clues[direction]}
                completedWords={completedWords}
                crossingNumber={
                  selectedDirection && selectedDirection !== direction
                    ? crossingClueNumber
                    : undefined
                }
                direction={direction}
                key={direction}
                onClueClick={handleClueClick}
                referencedNumbers={referencedNumbers[direction]}
                selectedNumber={
                  selectedDirection === direction
                    ? selectedClueNumber
                    : undefined
                }
              />
            ))}
          </div>

          {allCluesOpen && (
            <div className="md:hidden">
              <AllCluesView
                clues={clues}
                completedWords={completedWords}
                grid={grid}
                onBackspace={mobileBackspace}
                onLetter={enterMobileLetter}
                onNext={() => selectAdjacentClue("next")}
                onPrevious={() => selectAdjacentClue("previous")}
                onSelectClue={handleClueClick}
                onSelectSquare={handleAllCluesSquareClick}
                ref={allCluesRef}
                referencedNumbers={referencedNumbers}
                selection={selections.length === 1 ? selections[0] : undefined}
                solvingStatus={solvingStatus}
              />
            </div>
          )}
        </div>
        {/* When the start dialog was dismissed without starting, the blurred
            play area keeps a centered way back in. */}
        {!session.started && !startOpen && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center"
            data-testid="crossword-start-overlay"
          >
            <Button onClick={() => setStartOpen(true)} type="button">
              Start solving
            </Button>
          </div>
        )}
      </div>

      {session.started && !allCluesOpen && (
        <p
          aria-atomic="true"
          aria-live="polite"
          className="sr-only"
          data-testid="crossword-solving-status"
        >
          {solvingStatus}
        </p>
      )}
      <MobileSolveDock
        clue={selectedClue}
        direction={selectedDirection}
        onBackspace={mobileBackspace}
        onLetter={enterMobileLetter}
        onNext={() => selectAdjacentClue("next")}
        onPrevious={() => selectAdjacentClue("previous")}
        onToggleDirection={toggleSelectedDirection}
        visible={mobileDockVisible}
      />

      <StartDialog
        difficulties={puzzle.difficulties}
        onCloseAutoFocus={handleStartCloseAutoFocus}
        onOpenChange={setStartOpen}
        onShowTimerChange={(showTimer) => updateSettings({ showTimer })}
        onStart={handleStart}
        open={startOpen}
        showDesktopRecommendation={isLargePuzzle && customKeyboard}
        showTimer={settings.showTimer}
      />
      <PauseDialog
        elapsed={settings.showTimer ? formatDuration(session.elapsedMs) : null}
        onCloseAutoFocus={handlePauseCloseAutoFocus}
        onResume={session.resume}
        open={session.paused}
      />
      <IncorrectGridDialog
        onCloseAutoFocus={handleIncorrectCloseAutoFocus}
        onOpenChange={handleIncorrectOpenChange}
        open={incorrectOpen}
      />
      <SettingsDialog
        onCloseAutoFocus={handleSettingsCloseAutoFocus}
        onOpenChange={handleSettingsOpenChange}
        onSettingsChange={updateSettings}
        open={settingsOpen}
        settings={effectiveSettings}
      />
      {puzzle.celebration && (
        <ProposalCelebrationDialog
          celebration={puzzle.celebration}
          gridRef={gridRef}
          key={celebrationGeneration}
          onCloseAutoFocus={handleCelebrationCloseAutoFocus}
          onContinue={handleCelebrationContinue}
          open={celebrationRun !== null}
          puzzle={puzzle}
        />
      )}
      {session.postable && (
        <CompletionDialog
          difficulty={session.recordedDifficulty}
          elapsedMs={session.elapsedMs}
          isSignedIn={isSignedIn}
          onOpenChange={setCompletionOpen}
          onPost={handlePost}
          open={completionOpen}
          prefillName={prefillName}
          puzzleTitle={puzzle.title}
        />
      )}
      <LeaderboardDialog
        defaultDifficulty={session.recordedDifficulty}
        difficulties={puzzle.difficulties}
        onOpenChange={setLeaderboardOpen}
        open={leaderboardOpen}
        puzzleId={puzzle.id}
        puzzleTitle={puzzle.title}
        sessionId={session.sessionId ?? undefined}
      />
    </section>
  );
}
