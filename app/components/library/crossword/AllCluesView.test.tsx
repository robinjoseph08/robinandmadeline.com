import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ComponentProps, createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import AllCluesView, { type AllCluesViewHandle } from "./AllCluesView";
import { generateGridModel } from "./helpers";

const CLUES = {
  across: {
    "1": "First across",
    "4": "Second across",
    "5": "Third across",
  },
  down: {
    "1": "First down",
    "2": "Second down",
    "3": "Third down",
  },
};

function allCluesProps(
  overrides: Partial<ComponentProps<typeof AllCluesView>> = {},
): ComponentProps<typeof AllCluesView> {
  return {
    clues: CLUES,
    completedWords: new Set<string>(),
    grid: generateGridModel(3, 3, "X??Y??Z??"),
    onBackspace: vi.fn(),
    onLetter: vi.fn(),
    onNext: vi.fn(),
    onPrevious: vi.fn(),
    onSelectClue: vi.fn(),
    onSelectSquare: vi.fn(),
    referencedNumbers: { across: new Set<string>(), down: new Set<string>() },
    selection: { row: 0, col: 1, direction: "across" },
    solvingStatus: "1 Across, square 2 of 3, empty",
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

afterEach(() => {
  document.body.style.overflow = "";
  vi.unstubAllGlobals();
});

describe("AllCluesView", () => {
  it("renders inline with opaque sticky Across and Down headers", () => {
    document.body.style.overflow = "clip";

    render(
      <div data-testid="inline-host">
        <AllCluesView {...allCluesProps()} />
      </div>,
    );

    const host = screen.getByTestId("inline-host");
    const surface = within(host).getByTestId("crossword-all-clues");
    expect(surface).toBeInTheDocument();
    expect(surface).toHaveClass("pb-[var(--crossword-mobile-dock-height)]");
    expect(surface.className).not.toMatch(
      /overflow-y-auto|overscroll-contain|rounded|border/,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /close clue list/i }),
    ).toBeNull();
    expect(document.body.style.overflow).toBe("clip");

    const across = screen.getByRole("heading", { name: "Across" });
    const down = screen.getByRole("heading", { name: "Down" });
    expect(across.compareDocumentPosition(down)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(across).toHaveClass("sticky", "bg-background");
    expect(down).toHaveClass("sticky", "bg-background");
    expect(across).not.toHaveClass("rounded-md");
    expect(
      within(screen.getByTestId("crossword-clue-across-1")).getByText("1"),
    ).toHaveClass("text-left");
  });

  it("preserves authored clue line breaks", () => {
    render(
      <AllCluesView
        {...allCluesProps({
          clues: {
            ...CLUES,
            across: { ...CLUES.across, "1": "First line\n\nAuthor note" },
          },
        })}
      />,
    );

    const clue = screen.getByText(/First line/);
    expect(clue).toHaveClass("whitespace-pre-line");
    expect(clue.textContent).toBe("First line\n\nAuthor note");
  });

  it("shows only live entered values and reports clue and exact square selections", () => {
    const onSelectClue = vi.fn();
    const onSelectSquare = vi.fn();
    render(
      <AllCluesView {...allCluesProps({ onSelectClue, onSelectSquare })} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "1. First across" }));
    expect(onSelectClue).toHaveBeenCalledWith("1", "across");

    const entered = screen.getByRole("button", {
      name: "1 Across answer, square 1 of 3, X",
    });
    const empty = screen.getByRole("button", {
      name: "1 Across answer, square 2 of 3, empty, selected",
    });
    expect(entered).toHaveTextContent("X");
    expect(empty).toHaveTextContent("");

    fireEvent.click(empty);
    expect(onSelectSquare).toHaveBeenCalledWith({
      row: 0,
      col: 1,
      direction: "across",
    });
  });

  it("marks the current answer square and applies completion and reference state", () => {
    render(
      <AllCluesView
        {...allCluesProps({
          completedWords: new Set(["4:across"]),
          referencedNumbers: {
            across: new Set(["5"]),
            down: new Set<string>(),
          },
        })}
      />,
    );

    const selected = screen.getByRole("button", {
      name: "1 Across answer, square 2 of 3, empty, selected",
    });
    expect(selected).toHaveAttribute("aria-current", "true");
    expect(selected).toHaveClass("ring-2");
    expect(screen.getByTestId("crossword-clue-across-4")).toHaveClass(
      "text-muted-foreground",
    );
    expect(screen.getByTestId("crossword-clue-across-5")).toHaveClass(
      "bg-rose-soft",
    );
  });

  it("keeps all 15 answer squares in one responsive row", () => {
    render(
      <AllCluesView
        {...allCluesProps({
          clues: {
            across: { "1": "Fifteen-letter answer" },
            down: {},
          },
          grid: generateGridModel(15, 1),
          selection: { row: 0, col: 0, direction: "across" },
        })}
      />,
    );

    const answer = screen.getByRole("group", { name: "1 Across answer" });
    expect(answer).toHaveClass("grid", "w-full", "max-w-[22rem]", "gap-px");
    expect(answer).toHaveStyle({
      gridTemplateColumns: "repeat(15, minmax(0, 1fr))",
    });
    const squares = within(answer).getAllByRole("button");
    expect(squares).toHaveLength(15);
    for (const square of squares) {
      expect(square).toHaveClass("aspect-square", "w-full", "min-w-0");
    }
  });

  it("uses the same 15-column square sizing for short answers", () => {
    render(<AllCluesView {...allCluesProps()} />);

    const answer = screen.getByRole("group", { name: "1 Across answer" });
    expect(answer).toHaveStyle({
      gridTemplateColumns: "repeat(15, minmax(0, 1fr))",
    });
    expect(within(answer).getAllByRole("button")).toHaveLength(3);
  });

  it("supports physical solving keys and announces live solving status", () => {
    const callbacks = {
      onBackspace: vi.fn(),
      onLetter: vi.fn(),
      onNext: vi.fn(),
      onPrevious: vi.fn(),
    };
    render(<AllCluesView {...allCluesProps(callbacks)} />);

    const surface = screen.getByTestId("crossword-all-clues");
    fireEvent.keyDown(surface, { key: "q" });
    fireEvent.keyDown(surface, { key: "Backspace" });
    fireEvent.keyDown(surface, { key: "ArrowLeft" });
    fireEvent.keyDown(surface, { key: "ArrowRight" });
    fireEvent.keyDown(surface, { key: "x", metaKey: true });

    expect(callbacks.onLetter).toHaveBeenCalledWith("q");
    expect(callbacks.onLetter).toHaveBeenCalledTimes(1);
    expect(callbacks.onBackspace).toHaveBeenCalledTimes(1);
    expect(callbacks.onPrevious).toHaveBeenCalledTimes(1);
    expect(callbacks.onNext).toHaveBeenCalledTimes(1);
    expect(screen.getByText("1 Across, square 2 of 3, empty")).toHaveAttribute(
      "aria-live",
      "polite",
    );
  });

  it("exposes focusSelected for dialog focus restoration", () => {
    const ref = createRef<AllCluesViewHandle>();
    render(<AllCluesView {...allCluesProps()} ref={ref} />);

    act(() => ref.current?.focusSelected());

    expect(screen.getByRole("button", { current: true })).toHaveFocus();
  });

  it("scrolls the page, not a nested clue container, when selection leaves view", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const scrollBy = vi.fn();
    vi.stubGlobal("scrollBy", scrollBy);

    const view = render(
      <>
        <div data-testid="crossword-mobile-solve-dock" />
        <AllCluesView {...allCluesProps({ selection: undefined })} />
      </>,
    );
    const row = screen.getByTestId("crossword-clue-across-1");
    const dock = screen.getByTestId("crossword-mobile-solve-dock");
    row.getBoundingClientRect = () => rect(150, 180);
    dock.getBoundingClientRect = () => rect(100, 300);

    view.rerender(
      <>
        <div data-testid="crossword-mobile-solve-dock" />
        <AllCluesView {...allCluesProps()} />
      </>,
    );
    act(() => frame?.(0));

    expect(scrollBy).toHaveBeenCalledWith({ behavior: "smooth", top: 80 });
  });

  it("stays memoized around its forwarded ref surface", () => {
    expect((AllCluesView as { $$typeof?: symbol }).$$typeof).toBe(
      Symbol.for("react.memo"),
    );
  });
});
