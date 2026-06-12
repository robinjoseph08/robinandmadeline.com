import { useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal,
  Pause,
  Play,
  Settings as SettingsIcon,
  Trophy,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import CompletionDialog from "@/components/library/crossword/CompletionDialog";
import Grid, { GridHandle } from "@/components/library/crossword/Grid";
import {
  findWordByClueNumber,
  getCompletedWords,
  getSelectedWord,
} from "@/components/library/crossword/helpers";
import LeaderboardDialog from "@/components/library/crossword/LeaderboardDialog";
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
 * The crossword page behind /games/crossword/:puzzleSlug. The slug resolves
 * against the puzzle registry; an unknown slug gets the same friendly
 * not-found treatment as a bad info-collection link. The `key` on the game
 * forces a full remount when the slug changes, so navigating between puzzles
 * never carries one grid's state into the other.
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
 * letters. Progress persists to localStorage (keyed by puzzle id) so a guest
 * can refresh or come back later and resume; the solve clock and its
 * best-effort backend session live in useSolveSession.
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
  });
  const {
    complete: completeSession,
    setUiPaused,
    started: sessionStarted,
  } = session;

  const gridFull = isPuzzleComplete(grid);
  const solved = gridFull && validateSolution(grid, puzzle.solution);

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

  const handleStart = (chosen: Difficulty) => {
    setDifficulty(chosen);
    session.start(chosen);
    setStartOpen(false);
  };

  const handleSettingsOpenChange = (open: boolean) => {
    setSettingsOpen(open);
    setUiPaused(open);
  };

  // The leaderboard modal covers the grid just like the settings dialog, so
  // it pauses the clock the same way (setUiPaused is a no-op for a solve
  // that is finished or not yet started).
  const handleLeaderboardOpenChange = (open: boolean) => {
    setLeaderboardOpen(open);
    setUiPaused(open);
  };

  const handleDifficultySwitch = (level: Difficulty) => {
    setDifficultyMenuOpen(false);
    if (level === difficulty) {
      return;
    }
    setDifficulty(level);
    session.reportDifficulty(level);
  };

  // Prefill the leaderboard name for signed-in guests from their RSVP
  // record (the party's first guest is its primary member). Fetched lazily
  // when the completion dialog opens; any failure just means no prefill.
  const isSignedIn = readGuestToken() !== null;
  const { data: partyData } = usePartyRSVPs({
    enabled: completionOpen && isSignedIn && !session.posted,
  });
  const prefillName = partyData?.guests[0]?.full_name;

  // Warm the leaderboard while the completion dialog is up, so "View
  // leaderboard" opens populated.
  useLeaderboard(puzzle.id, { enabled: completionOpen });

  // The warm-up fetch above runs before the guest posts, so after a
  // successful post the cached leaderboard is missing their entry; refetch
  // it so "View leaderboard" shows them.
  const queryClient = useQueryClient();
  const handlePost = async (displayName: string) => {
    await session.postToLeaderboard(displayName);
    await queryClient.invalidateQueries({
      queryKey: [QueryKey.GameLeaderboard, puzzle.id],
    });
  };

  const clues = puzzle.clues[difficulty];
  const completedWords = getCompletedWords(grid);
  const selectedWord = getSelectedWord(grid, selections);
  const selectedClueNumber = selectedWord?.[0].number?.toString();
  const selectedDirection =
    selections.length === 1 ? selections[0].direction : undefined;

  const handleClueClick = (number: string, direction: Direction) => {
    const wordSelection = findWordByClueNumber(grid, number, direction);
    if (wordSelection) {
      gridRef.current?.setSelection(wordSelection);
    }
  };

  // The 15x15 needs more horizontal room than the mini, both for the page
  // and for the grid itself, so its squares stay comfortably tappable.
  const isLargePuzzle = puzzle.width > 10;

  // The solving area is obscured before the guest starts and while they are
  // explicitly paused, NYT-style, so the clock can't be beaten by reading
  // the puzzle off the clock. `inert` keeps keyboard focus out too.
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
          {settings.showTimer && session.started && (
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
              aria-label={session.paused ? "Resume timer" : "Pause timer"}
              onClick={session.paused ? session.resume : session.pause}
              size="icon"
              type="button"
              variant="ghost"
            >
              {session.paused ? <Play /> : <Pause />}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            onClick={() => handleLeaderboardOpenChange(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trophy />
            Leaderboard
          </Button>
          <Button
            aria-label="Settings"
            onClick={() => handleSettingsOpenChange(true)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <SettingsIcon />
          </Button>
          {session.started && !solved && (
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
                  Switch any time; your letters stay put. Your time is recorded
                  at the easiest difficulty you use.
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
          {/* An unreportable solve has no honest time to post (see
              initial.unreportable). */}
          {!session.posted && !initial.unreportable && (
            <Button
              className="mt-2"
              onClick={() => setCompletionOpen(true)}
              size="sm"
              type="button"
              variant="outline"
            >
              Post your time
            </Button>
          )}
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
          )}
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
        {obscured && (
          <div
            className="absolute inset-0 z-10 flex items-start justify-center rounded-md bg-cream pt-24"
            data-testid="crossword-grid-overlay"
          >
            {session.started ? (
              <Button onClick={session.resume} type="button">
                Resume
              </Button>
            ) : (
              <Button onClick={() => setStartOpen(true)} type="button">
                Start solving
              </Button>
            )}
          </div>
        )}
      </div>

      <StartDialog
        onOpenChange={setStartOpen}
        onShowTimerChange={(showTimer) => updateSettings({ showTimer })}
        onStart={handleStart}
        open={startOpen}
        showTimer={settings.showTimer}
      />
      <SettingsDialog
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
        onViewLeaderboard={() => {
          setCompletionOpen(false);
          handleLeaderboardOpenChange(true);
        }}
        open={completionOpen}
        posted={session.posted}
        prefillName={prefillName}
        puzzleTitle={puzzle.title}
      />
      <LeaderboardDialog
        onOpenChange={handleLeaderboardOpenChange}
        open={leaderboardOpen}
        puzzleId={puzzle.id}
        puzzleTitle={puzzle.title}
      />
    </section>
  );
}

interface ClueListProps {
  clues: Record<string, string>;
  completedWords: Set<string>;
  direction: Direction;
  onClueClick: (number: string, direction: Direction) => void;
  selectedNumber?: string;
}

function ClueList({
  clues,
  completedWords,
  direction,
  onClueClick,
  selectedNumber,
}: ClueListProps) {
  return (
    <section>
      <h2 className="text-lg font-semibold capitalize">{direction}</h2>
      <ol className="mt-2 space-y-1">
        {Object.entries(clues)
          .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
          .map(([number, clue]) => (
            <li key={number}>
              <button
                className={cn(
                  "w-full rounded px-2 py-1 text-left text-sm transition-colors hover:bg-secondary/30",
                  selectedNumber === number && "bg-secondary/50",
                  completedWords.has(`${number}:${direction}`) &&
                    "text-muted-foreground/70",
                )}
                onClick={() => onClueClick(number, direction)}
                type="button"
              >
                <span className="font-medium">{number}.</span> {clue}
              </button>
            </li>
          ))}
      </ol>
    </section>
  );
}
