import { createPortal } from "react-dom";

import MobileClueBar from "./MobileClueBar";
import MobileKeyboard from "./MobileKeyboard";
import type { Direction } from "./types";
import useCustomKeyboard from "./useCustomKeyboard";

interface MobileSolveDockProps {
  clue?: string;
  direction?: Direction;
  onBackspace: () => void;
  onLetter: (letter: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleDirection: () => void;
  visible: boolean;
}

/**
 * Fixed mobile solve controls. The body portal is intentional: the full-bleed
 * crossword section uses transforms for viewport-width layout, and a fixed
 * descendant of a transformed element is positioned against that element
 * instead of the visual viewport.
 */
export default function MobileSolveDock({
  clue,
  direction,
  onBackspace,
  onLetter,
  onNext,
  onPrevious,
  onToggleDirection,
  visible,
}: MobileSolveDockProps) {
  const customKeyboard = useCustomKeyboard();
  if (!visible || !customKeyboard) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 z-40"
      data-testid="crossword-mobile-solve-dock"
    >
      <MobileClueBar
        clue={clue}
        direction={direction}
        onNext={onNext}
        onPrevious={onPrevious}
        onToggleDirection={onToggleDirection}
        visible
      />
      <MobileKeyboard onBackspace={onBackspace} onLetter={onLetter} />
    </div>,
    document.body,
  );
}
