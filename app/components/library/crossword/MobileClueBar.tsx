import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { Direction } from "./types";

interface MobileClueBarProps {
  clue?: string;
  direction?: Direction;
  onNext: () => void;
  onPrevious: () => void;
  onToggleDirection: () => void;
  visible: boolean;
}

/** Current mobile clue, rendered directly above the themed keyboard. */
export default function MobileClueBar({
  clue,
  direction,
  onNext,
  onPrevious,
  onToggleDirection,
  visible,
}: MobileClueBarProps) {
  if (!visible || !clue || !direction) {
    return null;
  }

  const oppositeDirection = direction === "across" ? "down" : "across";

  return (
    <div
      className="border-y border-line bg-rose-soft/95 shadow-[0_-6px_18px_rgba(42,38,34,0.08)] backdrop-blur"
      data-testid="crossword-mobile-clue-bar"
    >
      <div className="flex min-h-16 items-stretch">
        <Button
          aria-label="Previous clue"
          className="h-auto min-w-12 rounded-none px-3"
          onClick={onPrevious}
          type="button"
          variant="ghost"
        >
          <ChevronLeft className="size-6" />
        </Button>
        <button
          aria-label={`Switch to ${oppositeDirection} clues`}
          className="min-w-0 flex-1 px-2 py-2 text-left"
          onClick={onToggleDirection}
          type="button"
        >
          <span aria-live="polite" className="line-clamp-2 leading-snug">
            {clue}
          </span>
        </button>
        <Button
          aria-label="Next clue"
          className="h-auto min-w-12 rounded-none px-3"
          onClick={onNext}
          type="button"
          variant="ghost"
        >
          <ChevronRight className="size-6" />
        </Button>
      </div>
    </div>
  );
}
