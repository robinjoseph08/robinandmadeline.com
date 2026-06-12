import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import Grid, { GridHandle } from "@/components/library/crossword/Grid";
import {
  findWordByClueNumber,
  getCompletedWords,
  getSelectedWord,
} from "@/components/library/crossword/helpers";
import {
  loadProgress,
  saveProgress,
} from "@/components/library/crossword/progress";
import {
  CrosswordPuzzle,
  DIFFICULTIES,
  Difficulty,
  entriesFromGrid,
  gridFromEntries,
} from "@/components/library/crossword/puzzle";
import { getPuzzleBySlug } from "@/components/library/crossword/puzzles";
import {
  Direction,
  GridModel,
  Selection,
} from "@/components/library/crossword/types";
import {
  isPuzzleComplete,
  validateSolution,
} from "@/components/library/crossword/validation";
import { Button } from "@/components/ui/button";
import { cn } from "@/libraries/utils";

const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

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
 * One puzzle's solve view. One grid with one set of answers; the difficulty
 * selector only swaps the clue text, so switching never touches entered
 * letters. Everything is client-side: progress persists to localStorage
 * (keyed by puzzle id) so a guest can refresh or come back later and resume.
 */
function CrosswordGame({ puzzle }: { puzzle: CrosswordPuzzle }) {
  // Restore any saved progress once, at mount. After this, the grid and the
  // difficulty live in component state and are written back on every change.
  const [initial] = useState(() => {
    const saved = loadProgress(puzzle.id);
    return {
      grid: gridFromEntries(puzzle, saved?.entries),
      difficulty: saved?.difficulty ?? ("easy" as Difficulty),
    };
  });
  const [difficulty, setDifficulty] = useState<Difficulty>(initial.difficulty);
  const [grid, setGrid] = useState<GridModel>(initial.grid);
  const [selections, setSelections] = useState<Selection[]>([]);
  const gridRef = useRef<GridHandle>(null);

  const complete = isPuzzleComplete(grid);
  const solved = complete && validateSolution(grid, puzzle.solution);

  useEffect(() => {
    saveProgress(puzzle.id, { entries: entriesFromGrid(grid), difficulty });
  }, [puzzle.id, grid, difficulty]);

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

  return (
    <section
      className={cn("mx-auto py-8", isLargePuzzle ? "max-w-5xl" : "max-w-4xl")}
    >
      <h1 className="text-3xl font-bold">{puzzle.title}</h1>
      <p className="mt-3 text-muted-foreground">
        Same answers, three flavors of clues. Pick your difficulty and switch
        any time; your letters stay put. Progress saves automatically in this
        browser.
      </p>

      <div
        aria-label="Difficulty"
        className="mt-6 flex flex-wrap gap-2"
        role="group"
      >
        {DIFFICULTIES.map((level) => (
          <Button
            aria-pressed={difficulty === level}
            key={level}
            onClick={() => setDifficulty(level)}
            size="sm"
            type="button"
            variant={difficulty === level ? "default" : "outline"}
          >
            {DIFFICULTY_LABELS[level]}
          </Button>
        ))}
      </div>

      {solved ? (
        <p className="mt-4 font-medium text-ink" role="status">
          You solved it! Congratulations, and see you on the dance floor.
        </p>
      ) : complete ? (
        <p className="mt-4 text-muted-foreground" role="status">
          The grid is full, but something is not quite right yet. Keep tweaking!
        </p>
      ) : null}

      <div
        className={cn(
          "mt-6 grid gap-8",
          isLargePuzzle
            ? "md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
            : "md:grid-cols-2",
        )}
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
                selectedDirection === direction ? selectedClueNumber : undefined
              }
            />
          ))}
        </div>
      </div>
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
