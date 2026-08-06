import {
  forwardRef,
  KeyboardEvent,
  memo,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import { cn } from "@/libraries/utils";

import type { Direction, GridModel, Selection, SquareModel } from "./types";

export interface AllCluesViewHandle {
  focusSelected: () => void;
}

export interface AllCluesViewProps {
  clues: Record<Direction, Record<string, string>>;
  completedWords: Set<string>;
  grid: GridModel;
  onBackspace: () => void;
  onLetter: (letter: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSelectClue: (number: string, direction: Direction) => void;
  onSelectSquare: (selection: Selection) => void;
  referencedNumbers: Record<Direction, Set<string>>;
  selection?: Selection;
  solvingStatus: string;
}

const DIRECTIONS: Direction[] = ["across", "down"];
const DIRECTION_LABELS: Record<Direction, string> = {
  across: "Across",
  down: "Down",
};

function squareKey(square: Pick<Selection, "row" | "col" | "direction">) {
  return `${square.row}:${square.col}:${square.direction}`;
}

function clueKey(number: string, direction: Direction) {
  return `${number}:${direction}`;
}

function buildWordsByClue(grid: GridModel) {
  const words = new Map<string, SquareModel[]>();

  for (const [key, word] of Object.entries(grid.wordMap)) {
    const direction = key.split(":")[2] as Direction;
    const number = word[0]?.number;
    if (number !== undefined) {
      words.set(clueKey(number.toString(), direction), word);
    }
  }

  return words;
}

function answerSquareLabel(
  number: string,
  direction: Direction,
  index: number,
  wordLength: number,
  value: string | undefined,
  selected: boolean,
) {
  const parts = [
    `${number} ${DIRECTION_LABELS[direction]} answer`,
    `square ${index + 1} of ${wordLength}`,
    value ?? "empty",
  ];
  if (selected) {
    parts.push("selected");
  }
  return parts.join(", ");
}

const AllCluesView = memo(
  forwardRef<AllCluesViewHandle, AllCluesViewProps>(function AllCluesView(
    {
      clues,
      completedWords,
      grid,
      onBackspace,
      onLetter,
      onNext,
      onPrevious,
      onSelectClue,
      onSelectSquare,
      referencedNumbers,
      selection,
      solvingStatus,
    },
    ref,
  ) {
    const surfaceRef = useRef<HTMLDivElement>(null);
    const answerSquareRefs = useRef(new Map<string, HTMLButtonElement>());
    const wordsByClue = useMemo(() => buildWordsByClue(grid), [grid]);
    const selectedWord = selection
      ? grid.wordMap[squareKey(selection)]
      : undefined;
    const selectedNumber = selectedWord?.[0]?.number?.toString();

    useImperativeHandle(
      ref,
      () => ({
        focusSelected() {
          if (!selection) {
            surfaceRef.current?.focus({ preventScroll: true });
            return;
          }
          const selectedSquare = answerSquareRefs.current.get(
            squareKey(selection),
          );
          if (selectedSquare) {
            selectedSquare.focus({ preventScroll: true });
          } else {
            surfaceRef.current?.focus({ preventScroll: true });
          }
        },
      }),
      [selection],
    );

    useEffect(() => {
      if (!selection || selectedNumber === undefined) {
        return;
      }

      const frame = requestAnimationFrame(() => {
        const surface = surfaceRef.current;
        const row = surface?.querySelector<HTMLElement>(
          `[data-clue-direction="${selection.direction}"][data-clue-number="${selectedNumber}"]`,
        );
        if (!surface || !row) {
          return;
        }

        const dock = document.querySelector<HTMLElement>(
          '[data-testid="crossword-mobile-solve-dock"]',
        );
        const controls = document.querySelector<HTMLElement>(
          '[aria-label="Crossword controls"]',
        );
        const directionHeading = row
          .closest("section")
          ?.querySelector<HTMLElement>("h2");
        const rowRect = row.getBoundingClientRect();
        const visibleTop = Math.max(
          controls?.getBoundingClientRect().bottom ?? 0,
          directionHeading?.getBoundingClientRect().bottom ?? 0,
        );
        const visibleBottom =
          dock?.getBoundingClientRect().top ?? window.innerHeight;
        let delta = 0;
        if (rowRect.top < visibleTop) {
          delta = rowRect.top - visibleTop;
        } else if (rowRect.bottom > visibleBottom) {
          delta = rowRect.bottom - visibleBottom;
        }
        if (delta !== 0) {
          window.scrollBy({ behavior: "smooth", top: delta });
        }
      });

      return () => cancelAnimationFrame(frame);
    }, [clues, selectedNumber, selection]);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.nativeEvent.isComposing
      ) {
        return;
      }
      if (/^[a-zA-Z]$/.test(event.key)) {
        event.preventDefault();
        onLetter(event.key);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        onBackspace();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        onPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        onNext();
      }
    };

    return (
      <div
        aria-label="Crossword clue list"
        className="bg-background pb-[var(--crossword-mobile-dock-height)] outline-none focus-visible:ring-2 focus-visible:ring-secondary"
        data-testid="crossword-all-clues"
        onKeyDown={handleKeyDown}
        ref={surfaceRef}
        role="region"
        tabIndex={0}
      >
        <p aria-atomic="true" aria-live="polite" className="sr-only">
          {solvingStatus}
        </p>
        {DIRECTIONS.map((direction) => (
          <section
            aria-labelledby={`crossword-all-clues-${direction}`}
            key={direction}
          >
            <h2
              className="sticky top-[46px] z-10 border-b border-line bg-background px-4 py-2 text-lg font-bold capitalize"
              id={`crossword-all-clues-${direction}`}
            >
              {DIRECTION_LABELS[direction]}
            </h2>
            <ol className="divide-y divide-line/70">
              {Object.entries(clues[direction])
                .sort(([a], [b]) => Number(a) - Number(b))
                .map(([number, clue]) => {
                  const word =
                    wordsByClue.get(clueKey(number, direction)) ?? [];
                  const selectedClue =
                    selection?.direction === direction &&
                    selectedNumber === number;
                  const completed = completedWords.has(
                    clueKey(number, direction),
                  );
                  const referenced = referencedNumbers[direction].has(number);

                  return (
                    <li
                      className={cn(
                        "px-3 py-3 transition-colors",
                        selectedClue && "bg-secondary/20",
                        referenced &&
                          "bg-rose-soft ring-1 ring-inset ring-rose/60",
                        completed && !referenced && "text-muted-foreground",
                      )}
                      data-clue-direction={direction}
                      data-clue-number={number}
                      data-testid={`crossword-clue-${direction}-${number}`}
                      key={number}
                    >
                      <button
                        aria-label={`${number}. ${clue}`}
                        className="flex w-full gap-3 text-left text-sm leading-snug outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-secondary"
                        onClick={() => onSelectClue(number, direction)}
                        type="button"
                      >
                        <span
                          aria-hidden="true"
                          className="w-6 shrink-0 text-left font-bold"
                        >
                          {number}
                        </span>
                        <span className="whitespace-pre-line">{clue}</span>
                      </button>
                      {word.length > 0 && (
                        <div
                          aria-label={`${number} ${DIRECTION_LABELS[direction]} answer`}
                          className="mt-2 grid w-full max-w-[22rem] gap-px"
                          role="group"
                          style={{
                            gridTemplateColumns: "repeat(15, minmax(0, 1fr))",
                          }}
                        >
                          {word.map((square, index) => {
                            const squareSelection = {
                              row: square.row,
                              col: square.col,
                              direction,
                            };
                            const selected =
                              selection?.row === square.row &&
                              selection.col === square.col &&
                              selection.direction === direction;
                            const refKey = squareKey(squareSelection);

                            return (
                              <button
                                aria-current={selected ? "true" : undefined}
                                aria-label={answerSquareLabel(
                                  number,
                                  direction,
                                  index,
                                  word.length,
                                  square.solution,
                                  selected,
                                )}
                                className={cn(
                                  "flex aspect-square w-full min-w-0 items-center justify-center border border-foreground/50 bg-background text-xs font-semibold uppercase outline-none focus-visible:ring-2 focus-visible:ring-secondary",
                                  selected &&
                                    "border-secondary bg-secondary/25 ring-2 ring-secondary ring-offset-1 ring-offset-background",
                                  completed && "text-muted-foreground",
                                )}
                                key={`${square.row}:${square.col}`}
                                onClick={() => onSelectSquare(squareSelection)}
                                ref={(node) => {
                                  if (node) {
                                    answerSquareRefs.current.set(refKey, node);
                                  } else {
                                    answerSquareRefs.current.delete(refKey);
                                  }
                                }}
                                type="button"
                              >
                                {square.solution ?? ""}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
            </ol>
          </section>
        ))}
      </div>
    );
  }),
);

AllCluesView.displayName = "AllCluesView";

export default AllCluesView;
