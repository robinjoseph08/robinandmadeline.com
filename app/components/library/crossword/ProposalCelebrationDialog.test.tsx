import { act, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GridHandle } from "@/components/library/crossword/Grid";
import ProposalCelebrationDialog from "@/components/library/crossword/ProposalCelebrationDialog";
import { proposal } from "@/components/library/crossword/puzzle-data-proposal";

vi.mock("react-confetti", () => ({
  default: () => <canvas data-testid="confetti-canvas" />,
}));

const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: height,
  });
}

function renderDialog(reducedMotion = false) {
  vi.stubGlobal("matchMedia", () => ({ matches: reducedMotion }));
  const gridRef = createRef<GridHandle>();
  gridRef.current = {
    backspace: vi.fn(),
    enterCharacter: vi.fn(),
    focus: vi.fn(),
    replaceGrid: vi.fn(),
    setSelection: vi.fn(),
    getCellRects: (cells) =>
      cells.map(({ row, col }) => ({
        left: col * 30,
        top: row * 30,
        width: 30,
        height: 30,
      })),
  };
  const onContinue = vi.fn();
  const dialog = (open: boolean) => (
    <ProposalCelebrationDialog
      celebration={proposal.celebration!}
      gridRef={gridRef}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onContinue={onContinue}
      open={open}
      puzzle={proposal}
    />
  );
  const view = render(dialog(true));
  return {
    onContinue,
    rerenderOpen(open: boolean) {
      view.rerender(dialog(open));
    },
  };
}

function cell(index: number): HTMLElement {
  return screen.getByTestId(`proposal-celebration-cell-${index}`);
}

function finalBounds(index: number) {
  const element = cell(index);
  const transform = element.style.getPropertyValue("--proposal-cell-transform");
  const match = transform.match(
    /^translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale\(([-\d.]+)\)$/,
  );
  if (!match) {
    throw new Error(`Unexpected proposal transform: ${transform}`);
  }
  const translateX = Number(match[1]);
  const translateY = Number(match[2]);
  const scale = Number(match[3]);
  const sourceLeft = Number.parseFloat(element.style.left);
  const sourceTop = Number.parseFloat(element.style.top);
  const sourceWidth = Number.parseFloat(element.style.width);
  const sourceHeight = Number.parseFloat(element.style.height);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    height,
    left: sourceLeft + sourceWidth / 2 + translateX - width / 2,
    top: sourceTop + sourceHeight / 2 + translateY - height / 2,
    width,
  };
}

describe("ProposalCelebrationDialog", () => {
  let nextFrameId: number;
  let frameCallbacks: Map<number, FrameRequestCallback>;

  function flushAnimationFrame() {
    const callbacks = [...frameCallbacks.values()];
    frameCallbacks.clear();
    act(() => {
      callbacks.forEach((callback) => callback(0));
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    setViewport(MOBILE_WIDTH, MOBILE_HEIGHT);
    nextFrameId = 1;
    frameCallbacks = new Map();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frameCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => {
      frameCallbacks.delete(id);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("animates mobile source cells into the compact proposal geometry", () => {
    renderDialog();

    expect(cell(0)).toHaveStyle({ height: "30px", left: "60px", top: "30px" });
    expect(cell(0)).not.toHaveClass("proposal-celebration-cell--final");

    const firstLine = finalBounds(0);
    expect(firstLine.left).toBeCloseTo(82.64375);
    expect(firstLine.top).toBeCloseTo(274.45);
    expect(firstLine.width).toBeCloseTo(45.7125);
    expect(finalBounds(4).top).toBeCloseTo(firstLine.top);
    expect(finalBounds(5).top).toBeGreaterThan(firstLine.top);
    expect(finalBounds(9).top).toBeGreaterThan(finalBounds(5).top);

    flushAnimationFrame();
    flushAnimationFrame();
    act(() => vi.advanceTimersByTime(2_999));
    expect(cell(0)).not.toHaveClass("proposal-celebration-cell--final");

    act(() => vi.advanceTimersByTime(1));
    expect(cell(0)).toHaveClass(
      "proposal-celebration-cell--final",
      "proposal-celebration-cell--revealing",
    );
    expect(cell(0)).toHaveStyle({ height: "30px", left: "60px", top: "30px" });
  });

  it("keeps an initial mobile reveal in flight across viewport resize", () => {
    renderDialog();
    flushAnimationFrame();
    flushAnimationFrame();
    act(() => vi.advanceTimersByTime(3_000));

    expect(cell(0)).toHaveClass("proposal-celebration-cell--revealing");
    const originalBounds = finalBounds(0);

    setViewport(412, 780);
    fireEvent(window, new Event("resize"));
    flushAnimationFrame();

    expect(cell(0)).toHaveClass("proposal-celebration-cell--revealing");
    expect(finalBounds(0).left).not.toBeCloseTo(originalBounds.left);

    act(() => vi.advanceTimersByTime(1_499));
    expect(cell(0)).toHaveClass("proposal-celebration-cell--revealing");
    act(() => vi.advanceTimersByTime(1));
    expect(cell(0)).not.toHaveClass("proposal-celebration-cell--revealing");
  });

  it("resets source geometry and replays confetti each time it opens", async () => {
    const { rerenderOpen } = renderDialog();
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const firstConfetti = screen.getByTestId("confetti-canvas");

    flushAnimationFrame();
    flushAnimationFrame();
    act(() => vi.advanceTimersByTime(3_000));
    expect(cell(0)).toHaveClass("proposal-celebration-cell--revealing");

    rerenderOpen(false);
    expect(
      screen.queryByTestId("crossword-proposal-celebration"),
    ).not.toBeInTheDocument();

    rerenderOpen(true);
    expect(cell(0)).toHaveStyle({ left: "60px", top: "30px", width: "30px" });
    expect(cell(0)).not.toHaveClass("proposal-celebration-cell--final");
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    const secondConfetti = screen.getByTestId("confetti-canvas");
    expect(secondConfetti).not.toBe(firstConfetti);

    flushAnimationFrame();
    flushAnimationFrame();
    act(() => vi.advanceTimersByTime(3_000));
    expect(cell(0)).toHaveClass("proposal-celebration-cell--revealing");
  });

  it("renders the extracted proposal cells and advances explicitly", async () => {
    const { onContinue } = renderDialog();

    expect(
      screen.getByTestId("crossword-proposal-celebration"),
    ).toHaveAccessibleDescription("WILL YOU MARRY ME");
    expect(screen.getAllByTestId(/^proposal-celebration-cell-/)).toHaveLength(
      17,
    );
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    expect(screen.getByTestId("proposal-confetti")).toBeInTheDocument();
    expect(screen.getByTestId("confetti-canvas")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to results" }),
    );
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("shows the final message without confetti when motion is reduced", () => {
    renderDialog(true);

    expect(screen.queryByTestId("proposal-confetti")).not.toBeInTheDocument();
    for (const proposalCell of screen.getAllByTestId(
      /^proposal-celebration-cell-/,
    )) {
      expect(proposalCell).toHaveClass("proposal-celebration-cell--final");
      expect(proposalCell).not.toHaveClass(
        "proposal-celebration-cell--revealing",
      );
    }
    expect(finalBounds(0).left).toBeCloseTo(82.64375);
    expect(
      screen.getByRole("button", { name: "Continue to results" }),
    ).toBeInTheDocument();
  });
});
