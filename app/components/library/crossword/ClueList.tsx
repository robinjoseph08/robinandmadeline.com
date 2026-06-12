// One direction's clues in an independently scrollable container, ported
// from the reference solver (crisscrosscx/solve): the selected clue is
// highlighted and kept scrolled into view as the cursor moves, the crossing
// clue gets an accent border, and completed clues fade.

import { memo, useEffect, useRef } from "react";

import { cn } from "@/libraries/utils";

import { Direction } from "./types";

interface ClueListProps {
  clues: Record<string, string>;
  completedWords: Set<string>;
  /** The clue crossing the cursor square (the opposite direction's word). */
  crossingNumber?: string;
  direction: Direction;
  onClueClick: (number: string, direction: Direction) => void;
  selectedNumber?: string;
}

/**
 * Memoized so the page's per-keystroke and per-clock-tick re-renders skip a
 * list whose props are unchanged. (The selected direction's list re-renders
 * only when the selected clue or a completion changes; the other direction's
 * list re-renders as the cursor's crossing clue changes, which the accent
 * and auto-scroll need anyway.)
 */
const ClueList = memo(function ClueList({
  clues,
  completedWords,
  crossingNumber,
  direction,
  onClueClick,
  selectedNumber,
}: ClueListProps) {
  const listRef = useRef<HTMLOListElement>(null);

  // Auto-scroll the active clue (selected, or crossing for the other
  // direction's list) into view as the selection moves through the grid.
  const activeNumber = selectedNumber ?? crossingNumber;
  useEffect(() => {
    const list = listRef.current;
    if (activeNumber === undefined || !list) {
      return;
    }
    const item = list.querySelector(`[data-clue-number="${activeNumber}"]`);
    if (!item) {
      return;
    }
    // Scroll the list's own scrollport rather than item.scrollIntoView():
    // scrollIntoView walks every scrollable ancestor including the viewport,
    // so in the single-column mobile layout (clues below the grid) it would
    // yank the page toward the clue lists on each keystroke. Only the list
    // itself may move, and only when the clue is outside its scrollport.
    const listRect = list.getBoundingClientRect();
    const itemRect = item.getBoundingClientRect();
    let delta = 0;
    if (itemRect.top < listRect.top) {
      delta = itemRect.top - listRect.top;
    } else if (itemRect.bottom > listRect.bottom) {
      delta = itemRect.bottom - listRect.bottom;
    }
    if (delta !== 0) {
      list.scrollTo({ behavior: "smooth", top: list.scrollTop + delta });
    }
  }, [activeNumber]);

  return (
    <section>
      <h2 className="text-lg font-semibold capitalize">{direction}</h2>
      <ol
        className="mt-2 max-h-64 space-y-1 overflow-y-auto overscroll-contain pr-1 md:max-h-[32rem]"
        data-testid={`crossword-clues-${direction}`}
        ref={listRef}
      >
        {Object.entries(clues)
          .sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10))
          .map(([number, clue]) => (
            <li data-clue-number={number} key={number}>
              <button
                className={cn(
                  "w-full rounded px-2 py-1 text-left text-sm transition-colors hover:bg-secondary/30",
                  selectedNumber === number && "bg-secondary/50",
                  // The crossing word's clue gets the reference's accent
                  // border (pl-1 keeps the text aligned with its siblings).
                  crossingNumber === number &&
                    "rounded-l-none border-l-4 border-secondary pl-1",
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
});

export default ClueList;
