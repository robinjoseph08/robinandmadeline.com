import { Delete } from "lucide-react";

import { cn } from "@/libraries/utils";

const LETTER_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Z", "X", "C", "V", "B", "N", "M"],
] as const;

const ROW_LAYOUTS = [
  "grid-cols-10",
  "mx-auto w-[90%] grid-cols-9",
  "grid-cols-10",
] as const;

interface MobileKeyboardProps {
  className?: string;
  onBackspace: () => void;
  onLetter: (letter: string) => void;
}

/** Wedding-themed mobile crossword keyboard that never summons the OS keyboard. */
export default function MobileKeyboard({
  className,
  onBackspace,
  onLetter,
}: MobileKeyboardProps) {
  return (
    <div
      aria-label="Crossword keyboard"
      className={cn(
        "w-full select-none space-y-1.5 border-t border-line bg-[#e9e2dc] px-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] pt-1.5 shadow-[0_-8px_24px_rgba(42,38,34,0.12)]",
        className,
      )}
      data-testid="crossword-mobile-keyboard"
      role="group"
    >
      <div className="mx-auto max-w-3xl space-y-1.5">
        {LETTER_ROWS.map((row, rowIndex) => (
          <div
            className={cn("grid w-full gap-1", ROW_LAYOUTS[rowIndex])}
            data-testid={`crossword-keyboard-row-${rowIndex + 1}`}
            key={row.join("")}
          >
            {rowIndex === 2 && <span aria-hidden className="h-11" />}
            {row.map((letter) => (
              <button
                aria-label={`Enter ${letter}`}
                className="h-11 min-w-0 touch-manipulation select-none rounded-md border border-line bg-surface text-lg font-semibold text-ink shadow-sm transition active:translate-y-px active:bg-rose-soft"
                key={letter}
                onClick={() => onLetter(letter)}
                onPointerDown={(event) => event.preventDefault()}
                type="button"
              >
                {letter}
              </button>
            ))}
            {rowIndex === 2 && (
              <button
                aria-label="Delete letter"
                className="col-span-2 flex h-11 min-w-11 touch-manipulation select-none items-center justify-center rounded-md border border-rose/40 bg-rose-soft text-ink shadow-sm transition active:translate-y-px active:bg-primary"
                onClick={onBackspace}
                onPointerDown={(event) => event.preventDefault()}
                type="button"
              >
                <Delete aria-hidden className="size-5" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
