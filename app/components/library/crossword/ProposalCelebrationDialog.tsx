import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  CSSProperties,
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type {
  GridCellRect,
  GridHandle,
} from "@/components/library/crossword/Grid";
import { generateGridModel } from "@/components/library/crossword/helpers";
import type {
  CrosswordPuzzle,
  ProposalCelebration,
} from "@/components/library/crossword/puzzle";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@/components/ui/dialog";

interface ProposalCelebrationDialogProps {
  celebration: ProposalCelebration;
  gridRef: RefObject<GridHandle | null>;
  onCloseAutoFocus: (event: Event) => void;
  onContinue: () => void;
  open: boolean;
  puzzle: CrosswordPuzzle;
}

interface ProposalCelebrationSceneProps {
  celebration: ProposalCelebration;
  gridRef: RefObject<GridHandle | null>;
  onContinue: () => void;
  puzzle: CrosswordPuzzle;
  reducedMotion: boolean;
}

interface PositionedCell {
  answer: string;
  isBlock: boolean;
  number?: number;
  source: GridCellRect;
  target: { left: number; top: number; size: number };
}

type AnimationPhase = "preparing" | "revealing" | "settled";
type ConfettiComponent = typeof import("react-confetti").default;
type ProposalCellStyle = CSSProperties & {
  "--proposal-cell-transform": string;
};

const DESKTOP_GAP = 4;
const MOBILE_GAP = 5;
const VIEWPORT_PADDING = 16;
const FINAL_SCALE = 1.15;
const REVEAL_DELAY_MS = 3_000;
const REVEAL_DURATION_MS = 1_500;

function reducedMotionPreferred(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function viewportSize() {
  return {
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
}

function compactLines(lineLengths: number[]): number[][] {
  let offset = 0;
  return lineLengths.map((length) => {
    const line = Array.from({ length }, (_, index) => offset + index);
    offset += length;
    return line;
  });
}

function targetsForViewport(
  count: number,
  compactLineLengths: number[],
  width: number,
  height: number,
): Array<{
  left: number;
  top: number;
  size: number;
}> {
  const desktopSize = Math.min(
    44,
    Math.max(28, (width - 32) / count - DESKTOP_GAP),
  );
  const desktopWidth = count * desktopSize + (count - 1) * DESKTOP_GAP;

  if (desktopWidth <= width - 32 && width >= 720 && height > 360) {
    const left = (width - desktopWidth) / 2;
    const top = Math.max(80, height / 2 - desktopSize / 2 - 24);
    return Array.from({ length: count }, (_, index) => ({
      left: left + index * (desktopSize + DESKTOP_GAP),
      top,
      size: desktopSize,
    }));
  }

  const lines = compactLines(compactLineLengths);
  const longestLine = Math.max(...lines.map((line) => line.length));
  const compactControls = height <= 360;
  const resultsCardHeight = compactControls ? 64 : 120;
  const resultsBottomInset = compactControls ? 4 : 20;
  const messageTop = compactControls ? 4 : VIEWPORT_PADDING;
  const messageBottom = Math.max(
    messageTop + 20,
    height - resultsCardHeight - resultsBottomInset - 8,
  );
  const availableHeight = messageBottom - messageTop;
  const lineGap = Math.min(10, Math.max(2, availableHeight * 0.04));
  const sizeByWidth = (width - VIEWPORT_PADDING * 2) / longestLine - MOBILE_GAP;
  // The final state is scaled to 115%, so reserve that space up front.
  const sizeByHeight =
    (availableHeight - (lines.length - 1) * lineGap) /
    lines.length /
    FINAL_SCALE;
  const size = Math.max(8, Math.min(48, sizeByWidth, sizeByHeight));
  const lineHeight = size * FINAL_SCALE + lineGap;
  const messageHeight =
    lines.length * size * FINAL_SCALE + (lines.length - 1) * lineGap;
  const firstTop =
    messageTop + Math.max(0, (availableHeight - messageHeight) / 2);
  const targets = Array.from({ length: count }, () => ({
    left: width / 2,
    top: height / 2,
    size,
  }));

  lines.forEach((line, lineIndex) => {
    const lineWidth = line.length * size + (line.length - 1) * MOBILE_GAP;
    const lineLeft = (width - lineWidth) / 2;
    line.forEach((cellIndex, index) => {
      targets[cellIndex] = {
        left: lineLeft + index * (size + MOBILE_GAP),
        top: firstTop + lineIndex * lineHeight,
        size,
      };
    });
  });

  return targets;
}

function finalTransform(cell: PositionedCell): string {
  const scale = (cell.target.size * FINAL_SCALE) / cell.source.width;
  const translateX =
    cell.target.left +
    cell.target.size / 2 -
    (cell.source.left + cell.source.width / 2);
  const translateY =
    cell.target.top +
    cell.target.size / 2 -
    (cell.source.top + cell.source.height / 2);
  return `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
}

function ProposalCelebrationScene({
  celebration,
  gridRef,
  onContinue,
  puzzle,
  reducedMotion,
}: ProposalCelebrationSceneProps) {
  const [sourceRects, setSourceRects] = useState<GridCellRect[]>([]);
  const [phase, setPhase] = useState<AnimationPhase>(() =>
    reducedMotion ? "settled" : "preparing",
  );
  const [Confetti, setConfetti] = useState<ConfettiComponent | null>(null);
  const [viewport, setViewport] = useState(() => viewportSize());
  const phaseRef = useRef(phase);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );

  const measureSourceCells = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        setSourceRects(gridRef.current?.getCellRects(celebration.cells) ?? []);
      }
    },
    [celebration.cells, gridRef],
  );

  const changePhase = useCallback((nextPhase: AnimationPhase) => {
    phaseRef.current = nextPhase;
    setPhase(nextPhase);
  }, []);

  const scheduleSettledPhase = useCallback(() => {
    if (settleTimerRef.current !== undefined) {
      clearTimeout(settleTimerRef.current);
    }
    settleTimerRef.current = setTimeout(
      () => changePhase("settled"),
      REVEAL_DURATION_MS,
    );
  }, [changePhase]);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }

    let secondFrame: number | undefined;
    let revealTimer: ReturnType<typeof setTimeout> | undefined;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        revealTimer = setTimeout(() => {
          changePhase("revealing");
          scheduleSettledPhase();
        }, REVEAL_DELAY_MS);
      });
    });

    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== undefined) {
        cancelAnimationFrame(secondFrame);
      }
      if (revealTimer !== undefined) {
        clearTimeout(revealTimer);
      }
      if (settleTimerRef.current !== undefined) {
        clearTimeout(settleTimerRef.current);
      }
    };
  }, [changePhase, reducedMotion, scheduleSettledPhase]);

  useEffect(() => {
    let resizeFrame: number | undefined;
    const handleResize = () => {
      if (resizeFrame !== undefined) {
        cancelAnimationFrame(resizeFrame);
      }
      resizeFrame = requestAnimationFrame(() => {
        setViewport(viewportSize());
        if (phaseRef.current === "revealing") {
          scheduleSettledPhase();
        }
      });
    };
    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
      if (resizeFrame !== undefined) {
        cancelAnimationFrame(resizeFrame);
      }
    };
  }, [scheduleSettledPhase]);

  useEffect(() => {
    if (reducedMotion) {
      return;
    }
    let active = true;
    import("react-confetti")
      .then((module) => {
        if (active) {
          setConfetti(() => module.default);
        }
      })
      .catch(() => {
        // Confetti is decorative. A stale deployment chunk or offline load
        // must never take down the proposal or block the results workflow.
      });
    return () => {
      active = false;
    };
  }, [reducedMotion]);

  const cells = useMemo<PositionedCell[]>(() => {
    if (
      sourceRects.length !== celebration.cells.length ||
      viewport.width === 0
    ) {
      return [];
    }
    const solvedGrid = generateGridModel(
      puzzle.width,
      puzzle.height,
      puzzle.solution,
    );
    const targets = targetsForViewport(
      celebration.cells.length,
      celebration.compactLineLengths,
      viewport.width,
      viewport.height,
    );
    return celebration.cells.map(({ row, col }, index) => {
      const answer = puzzle.solution[row * puzzle.width + col];
      const square = solvedGrid.squares[row * puzzle.width + col];
      return {
        answer,
        isBlock: answer === ".",
        number: square.number,
        source: sourceRects[index],
        target: targets[index],
      };
    });
  }, [
    celebration.cells,
    celebration.compactLineLengths,
    puzzle.height,
    puzzle.solution,
    puzzle.width,
    sourceRects,
    viewport.height,
    viewport.width,
  ]);

  return (
    <div className="contents" ref={measureSourceCells}>
      {!reducedMotion && Confetti && viewport.width > 0 && (
        <div
          aria-hidden="true"
          className="absolute inset-0 z-0"
          data-testid="proposal-confetti"
        >
          <Confetti
            gravity={0.15}
            height={viewport.height}
            numberOfPieces={500}
            recycle={false}
            width={viewport.width}
          />
        </div>
      )}

      <div aria-hidden="true" className="absolute inset-0 z-10">
        {cells.map((cell, index) => {
          const final = reducedMotion || phase !== "preparing";
          const style: ProposalCellStyle = {
            "--proposal-cell-transform": finalTransform(cell),
            height: cell.source.height,
            left: cell.source.left,
            top: cell.source.top,
            width: cell.source.width,
          };
          return (
            <div
              className={`proposal-celebration-cell @container ${
                cell.isBlock ? "bg-ink" : "bg-surface text-ink"
              } ${final ? "proposal-celebration-cell--final" : ""} ${
                phase === "revealing"
                  ? "proposal-celebration-cell--revealing"
                  : ""
              }`}
              data-testid={`proposal-celebration-cell-${index}`}
              key={`${celebration.cells[index].row}:${celebration.cells[index].col}`}
              style={style}
            >
              {!cell.isBlock && (
                <>
                  {cell.number !== undefined && (
                    <span className="absolute left-[5cqw] top-[3cqw] text-[18cqw] leading-none">
                      {cell.number}
                    </span>
                  )}
                  <span className="flex h-full items-end justify-center pb-[8cqw] text-[60cqw] font-bold leading-none">
                    {cell.answer}
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="proposal-results-card absolute inset-x-4 bottom-5 z-20 mx-auto flex max-w-sm flex-col items-center gap-3 rounded-lg bg-surface/95 p-4 text-center shadow-xl backdrop-blur-sm sm:bottom-8">
        <p className="font-medium">You solved it!</p>
        <Button autoFocus onClick={onContinue} type="button">
          Continue to results
        </Button>
      </div>
    </div>
  );
}

export default function ProposalCelebrationDialog({
  celebration,
  gridRef,
  onCloseAutoFocus,
  onContinue,
  open,
  puzzle,
}: ProposalCelebrationDialogProps) {
  const reducedMotion = reducedMotionPreferred();
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      onContinue();
    }
  };

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogPortal>
        <DialogOverlay className="proposal-celebration-overlay bg-black/35" />
        <DialogPrimitive.Content
          aria-describedby="proposal-celebration-description"
          className="fixed inset-0 z-50 overflow-hidden outline-none"
          data-testid="crossword-proposal-celebration"
          onCloseAutoFocus={onCloseAutoFocus}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <DialogTitle className="sr-only">You solved it</DialogTitle>
          <DialogDescription
            className="sr-only"
            id="proposal-celebration-description"
          >
            {celebration.message}
          </DialogDescription>

          {open && (
            <ProposalCelebrationScene
              celebration={celebration}
              gridRef={gridRef}
              onContinue={onContinue}
              puzzle={puzzle}
              reducedMotion={reducedMotion}
            />
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
