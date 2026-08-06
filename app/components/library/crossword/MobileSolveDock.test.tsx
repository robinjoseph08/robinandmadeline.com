import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MobileSolveDock from "./MobileSolveDock";

vi.mock("./useCustomKeyboard", () => ({
  default: () => true,
}));

function rect(height: number): DOMRect {
  return {
    top: 0,
    bottom: height,
    left: 0,
    right: 390,
    width: 390,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  document.documentElement.style.removeProperty(
    "--crossword-mobile-dock-height",
  );
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MobileSolveDock", () => {
  it("measures the fixed dock for page padding and clears the inset on unmount", () => {
    let height = 260;
    let resize: ResizeObserverCallback | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {
          disconnect();
        }
      },
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        return this.dataset.testid === "crossword-mobile-solve-dock"
          ? rect(height)
          : rect(0);
      },
    );

    const view = render(
      <MobileSolveDock
        clue="Test clue"
        direction="across"
        onBackspace={() => {}}
        onLetter={() => {}}
        onNext={() => {}}
        onPrevious={() => {}}
        onToggleDirection={() => {}}
        visible
      />,
    );

    expect(screen.getByTestId("crossword-mobile-solve-dock")).toBeVisible();
    expect(
      document.documentElement.style.getPropertyValue(
        "--crossword-mobile-dock-height",
      ),
    ).toBe("260px");

    height = 275;
    resize?.([], {} as ResizeObserver);
    expect(
      document.documentElement.style.getPropertyValue(
        "--crossword-mobile-dock-height",
      ),
    ).toBe("275px");

    view.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(
      document.documentElement.style.getPropertyValue(
        "--crossword-mobile-dock-height",
      ),
    ).toBe("");
  });
});
