import { useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal,
  Pause,
  Settings as SettingsIcon,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import ClueList from "@/components/library/crossword/ClueList";
import CompletionDialog from "@/components/library/crossword/CompletionDialog";
import Grid, { GridHandle } from "@/components/library/crossword/Grid";
import {
  findWordByClueNumber,
  getCompletedWords,
  getSelectedWord,
} from "@/components/library/crossword/helpers";
import LeaderboardDialog from "@/components/library/crossword/LeaderboardDialog";
import PauseDialog from "@/components/library/crossword/PauseDialog";
import {
  loadProgress,
  saveProgress,
} from "@/components/library/crossword/progress";
import {
  CrosswordPuzzle,
  DIFFICULTIES,
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

  return <CrosswordGame key={puzzle.id} puzzle={puzzle} />;
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
function CrosswordGame({ puzzle }: { puzzle: CrosswordPuzzle }) {
  // Restore any saved progress once, at mount. After this, the grid and the
  // difficulty live in component state and are written back on every change.
  const [initial] = useState(() => {
    const saved = loadProgress(puzzle.id);
    const grid = gridFromEntries(puzzle, saved?.entries);
    const solved =
      isPuzzleComplete(grid) && validateSolution(grid, puzzle.solution);
    return {
      grid,
      difficulty: saved?.difficulty ?? ("easy" as Difficulty),
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
  const [completionOpen, setCompletionOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [difficultyMenuOpen, setDifficultyMenuOpen] = useState(false);
  const gridRef = useRef<GridHandle>(null);

  const session = useSolveSession({
    puzzleId: puzzle.id,
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
    saveProgress(puzzle.id, { entries: entriesFromGrid(grid), difficulty });
  }, [puzzle.id, grid, difficulty, sessionStarted]);

  // Completion: report it once, and celebrate only a solve that happened in
  // this visit (a returning guest whose grid was already solved gets the
  // inline summary, not the dialog again).
  const completionCelebratedRef = useRef(initial.solved);
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
      setCompletionOpen(true);
    }
  }, [solved, sessionStarted, completeSession, initial.unreportable]);

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

  // Resuming from the pause dialog always returns focus to the grid; the
  // prior selection (if any) is still in the grid's state, so typing picks
  // up exactly where the guest left off.
  const handlePauseCloseAutoFocus = (event: Event) => {
    event.preventDefault();
    focusGrid();
  };

  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open);
    setUiPaused(open);
  };

  // Closing the settings dialog returns focus to the grid so typing works
  // immediately, unless the play area is inert (pre-start, or paused behind
  // the pause dialog), where focus must stay out.
  const handleSettingsCloseAutoFocus = (event: Event) => {
    if (session.started && !session.paused) {
      event.preventDefault();
      focusGrid();
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
    { enabled: completionOpen },
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

  const clues = puzzle.clues[difficulty];
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

  // Reads the live grid through a ref (synced in an effect) so the callback
  // stays referentially stable and never forces the memoized clue lists to
  // re-render by changing identity.
  const liveGridRef = useRef(grid);
  useEffect(() => {
    liveGridRef.current = grid;
  }, [grid]);
  const handleClueClick = useCallback(
    (number: string, direction: Direction) => {
      const wordSelection = findWordByClueNumber(
        liveGridRef.current,
        number,
        direction,
      );
      if (wordSelection) {
        gridRef.current?.setSelection(wordSelection);
      }
    },
    [],
  );

  // The 15x15 needs more horizontal room than the mini, both for the page
  // and for the grid itself, so its squares stay comfortably tappable.
  const isLargePuzzle = puzzle.width > 10;

  // The solving area is obscured before the guest starts and while they are
  // explicitly paused, NYT-style, so the clock can't be beaten by reading
  // the puzzle off the clock. The whole play area (grid AND clues) blurs,
  // and `inert` keeps keyboard focus out too.
  const obscured = !session.started || session.paused;

  return (
    <section
      className={cn("mx-auto py-8", isLargePuzzle ? "max-w-5xl" : "max-w-4xl")}
    >
      <h1 className="text-3xl font-bold">{puzzle.title}</h1>
      <p className="mt-3 text-muted-foreground">
        Same answers, three flavors of clues. Your progress saves automatically
        in this browser, and the fastest solvers make the leaderboard.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
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
          <Button
            aria-label="Settings"
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
          {session.started && (
            <Popover
              onOpenChange={setDifficultyMenuOpen}
              open={difficultyMenuOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  aria-label="More options"
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
                  {DIFFICULTIES.map((level) => (
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
            {!session.posted && !initial.unreportable && (
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
          </div>
        </div>
      ) : gridFull ? (
        <p className="mt-4 text-muted-foreground" role="status">
          The grid is full, but something is not quite right yet. Keep tweaking!
        </p>
      ) : null}

      <div className="relative mt-6">
        <div
          className={cn(
            "grid gap-8",
            isLargePuzzle
              ? "md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
              : "md:grid-cols-2",
            // While obscured, the entire play area (grid AND clues) blurs:
            // no sliver of puzzle peeks out at any viewport size, nothing is
            // readable, and inert keeps it non-interactive.
            obscured && "pointer-events-none select-none blur-md",
          )}
          data-testid="crossword-play-area"
          inert={obscured || undefined}
        >
          <Grid
            className={cn(
              "mx-auto h-fit w-full",
              isLargePuzzle ? "max-w-xl" : "max-w-md",
            )}
            initialGrid={initial.grid}
            isSolved={solved}
            onGridChange={setGrid}
            onSelectionChange={setSelections}
            ref={gridRef}
            settings={settings}
            solution={puzzle.solution}
          />

          <div className="grid gap-6 sm:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
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
                selectedNumber={
                  selectedDirection === direction
                    ? selectedClueNumber
                    : undefined
                }
              />
            ))}
          </div>
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

      <StartDialog
        onCloseAutoFocus={handleStartCloseAutoFocus}
        onOpenChange={setStartOpen}
        onShowTimerChange={(showTimer) => updateSettings({ showTimer })}
        onStart={handleStart}
        open={startOpen}
        showTimer={settings.showTimer}
      />
      <PauseDialog
        elapsed={settings.showTimer ? formatDuration(session.elapsedMs) : null}
        onCloseAutoFocus={handlePauseCloseAutoFocus}
        onResume={session.resume}
        open={session.paused}
      />
      <SettingsDialog
        onCloseAutoFocus={handleSettingsCloseAutoFocus}
        onOpenChange={handleSettingsOpenChange}
        onSettingsChange={updateSettings}
        open={settingsOpen}
        settings={settings}
      />
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
      <LeaderboardDialog
        defaultDifficulty={session.recordedDifficulty}
        onOpenChange={setLeaderboardOpen}
        open={leaderboardOpen}
        puzzleId={puzzle.id}
        puzzleTitle={puzzle.title}
        sessionId={session.sessionId ?? undefined}
      />
    </section>
  );
}
