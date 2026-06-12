// The clue list's auto-scroll cannot be exercised through the page in jsdom
// (no layout), so the mechanism is pinned here with mocked rects: the active
// clue scrolls ONLY the list's own scrollport (scrollIntoView would walk
// every scrollable ancestor and yank the page toward the clue lists on each
// keystroke in the single-column mobile layout), and the export stays
// memoized so the page's per-keystroke re-renders skip unchanged lists.

import { render, screen } from "@testing-library/react";
import { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import ClueList from "./ClueList";

const CLUES: Record<string, string> = {
  "1": "First clue",
  "5": "Fifth clue",
  "8": "Eighth clue",
};

function clueListProps(
  overrides: Partial<ComponentProps<typeof ClueList>> = {},
): ComponentProps<typeof ClueList> {
  return {
    clues: CLUES,
    completedWords: new Set<string>(),
    direction: "across",
    onClueClick: () => {},
    ...overrides,
  };
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 0,
    width: 0,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * Renders the list with no active clue, then installs rect mocks placing one
 * clue outside the 0-100 scrollport (and everything else inside it) plus a
 * scrollTo spy, so a rerender with an active clue exercises the scroll
 * effect against measurable geometry.
 */
function renderWithGeometry(outsideNumber: string, outside: DOMRect) {
  const view = render(<ClueList {...clueListProps()} />);
  const list = screen.getByTestId("crossword-clues-across");
  const scrollTo = vi.fn();
  Object.assign(list, { scrollTo });
  list.getBoundingClientRect = () => rect(0, 100);
  for (const item of Array.from(list.querySelectorAll("li"))) {
    (item as HTMLElement).getBoundingClientRect =
      item.getAttribute("data-clue-number") === outsideNumber
        ? () => outside
        : () => rect(10, 30);
  }
  return {
    scrollTo,
    rerenderWith(overrides: Partial<ComponentProps<typeof ClueList>>) {
      view.rerender(<ClueList {...clueListProps(overrides)} />);
    },
  };
}

describe("ClueList", () => {
  it("scrolls its own scrollport down to a selected clue below it", () => {
    const { rerenderWith, scrollTo } = renderWithGeometry("5", rect(150, 170));

    rerenderWith({ selectedNumber: "5" });

    // Exactly the overflow (item bottom 170 vs scrollport bottom 100), on
    // the list itself; the right clue had to be measured for this delta, so
    // a regression that scrolls to the wrong clue scrolls by zero instead.
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 70 });
  });

  it("scrolls up to a crossing clue above the scrollport when nothing is selected in this direction", () => {
    const { rerenderWith, scrollTo } = renderWithGeometry("8", rect(-40, -20));
    const list = screen.getByTestId("crossword-clues-across");
    list.scrollTop = 90;

    rerenderWith({ crossingNumber: "8" });

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 50 });
  });

  it("does not scroll when the active clue is already within the scrollport", () => {
    const { rerenderWith, scrollTo } = renderWithGeometry("5", rect(150, 170));

    rerenderWith({ selectedNumber: "1" });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("re-measures when the clue set changes, keeping the active clue in view across a difficulty switch", () => {
    const { rerenderWith, scrollTo } = renderWithGeometry("5", rect(150, 170));

    rerenderWith({ selectedNumber: "5" });
    expect(scrollTo).toHaveBeenCalledTimes(1);

    // Swapping clue text (same numbers, as a difficulty switch does)
    // re-flows item heights, so the effect must re-run against the new
    // geometry even though the active number is unchanged.
    rerenderWith({
      clues: { ...CLUES, "1": "Rewritten first clue" },
      selectedNumber: "5",
    });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it("stays memoized so the page's unrelated re-renders skip unchanged lists", () => {
    // The typing-performance work hangs off this export being memo-wrapped;
    // render counting cannot see it from the page (the component boundary is
    // what React.memo compares), so pin the wrapper directly.
    expect((ClueList as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });
});
