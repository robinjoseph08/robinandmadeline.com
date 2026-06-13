// The leaderboard dialog's secondary states: loading, error, empty, the
// truncation footer, and the difficulty tabs' fetch and default behavior,
// plus the show-all list (every returned row rendered inside its own
// scrollport), the podium treatment for the top three, and the open-time
// auto-scroll to the viewer's own row. The auto-scroll, like the clue list's,
// cannot run through real layout in jsdom, so it is pinned with mocked rects:
// the viewer row is centered in the list's OWN scrollport (a bare
// scrollIntoView would walk scrollable ancestors and move the dialog or page).
// The populated happy path also renders through the page in
// Crossword.session.test.tsx.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QueryKey } from "@/hooks/queries/games";

import LeaderboardDialog from "./LeaderboardDialog";
import type { Difficulty } from "./puzzle";

const apiRequest = vi.fn();
vi.mock("@/libraries/api", async () => {
  const actual = await vi.importActual<object>("@/libraries/api");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  };
});

function renderDialog({
  defaultDifficulty,
  open = true,
  sessionId,
}: {
  defaultDifficulty?: Difficulty;
  open?: boolean;
  sessionId?: string;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <LeaderboardDialog
        defaultDifficulty={defaultDifficulty}
        onOpenChange={() => {}}
        open={open}
        puzzleId="wedding-mini-v1"
        puzzleTitle="The Wedding Mini"
        sessionId={sessionId}
      />
    </QueryClientProvider>,
  );
  return {
    ...view,
    queryClient,
    rerenderOpen(value: boolean) {
      view.rerender(
        <QueryClientProvider client={queryClient}>
          <LeaderboardDialog
            defaultDifficulty={defaultDifficulty}
            onOpenChange={() => {}}
            open={value}
            puzzleId="wedding-mini-v1"
            puzzleTitle="The Wedding Mini"
            sessionId={sessionId}
          />
        </QueryClientProvider>,
      );
    },
  };
}

type Entry = {
  display_name: string;
  difficulty: Difficulty;
  elapsed_ms: number;
  completed_at: string;
};

/** One leaderboard entry; the fields the dialog reads, with sane defaults. */
function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    display_name: "Solver",
    difficulty: "easy",
    elapsed_ms: 60_000,
    completed_at: "2026-06-10T00:00:00Z",
    ...overrides,
  };
}

/** A minimal DOMRect for the geometry-based auto-scroll, as in ClueList. */
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
 * Installs rect mocks placing the viewer's row at `viewerRect` and the list's
 * scrollport at 0-100, plus a scrollTo spy, so the open-time auto-scroll
 * effect runs against measurable geometry. jsdom has no layout, so without
 * this every rect is a zero box and the effect can't tell where the viewer's
 * row sits, exactly as the clue-list test does. The viewer row is found by the
 * "You" badge, or by `targetText` when the badge isn't present yet (the
 * geometry has to be pinned on the persisted node BEFORE the viewer arrives,
 * so the effect re-runs against it, mirroring the clue list's render-then-flip).
 */
function mockListGeometry(
  viewerRect: DOMRect,
  {
    scrollTop = 0,
    targetText,
  }: { scrollTop?: number; targetText?: string } = {},
) {
  const list = screen.getByTestId("crossword-leaderboard-list");
  const scrollTo = vi.fn();
  Object.assign(list, { scrollTo, scrollTop });
  list.getBoundingClientRect = () => rect(0, 100);
  for (const item of Array.from(list.querySelectorAll("li"))) {
    const el = item as HTMLElement;
    const isViewer = targetText
      ? Boolean(within(el).queryByText(targetText))
      : Boolean(within(el).queryByText("You"));
    el.getBoundingClientRect = isViewer ? () => viewerRect : () => rect(10, 30);
  }
  return scrollTo;
}

describe("LeaderboardDialog", () => {
  beforeEach(() => {
    apiRequest.mockReset();
    // The auto-scroll measures on the next animation frame (so a reopened
    // Radix portal's freshly mounted list has laid out before it is read); run
    // that frame synchronously so the geometry assertions stay deterministic,
    // the same posture the clue-list scroll test relies on for its effect.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the loading copy while the leaderboard is fetching", () => {
    apiRequest.mockImplementation(() => new Promise(() => {}));

    renderDialog();

    expect(
      screen.getByText(/loading the fastest solvers/i),
    ).toBeInTheDocument();
  });

  it("shows the error copy when the fetch fails", async () => {
    apiRequest.mockRejectedValue(new Error("network down"));

    renderDialog();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't load the leaderboard/i,
    );
  });

  it("shows the empty state when nobody has posted yet", async () => {
    apiRequest.mockResolvedValue({ items: [], total: 0 });

    renderDialog();

    expect(
      await screen.findByText(/no easy times posted yet/i),
    ).toBeInTheDocument();
  });

  it("defaults to easy and fetches with the difficulty param", async () => {
    apiRequest.mockResolvedValue({ items: [], total: 0 });

    renderDialog();

    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(
      "Easy",
    );
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/games/leaderboard?puzzle_id=wedding-mini-v1&difficulty=easy",
      ),
    );
  });

  it("fetches the clicked tab's difficulty", async () => {
    apiRequest.mockResolvedValue({ items: [], total: 0 });

    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Medium" }));

    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(
      "Medium",
    );
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/games/leaderboard?puzzle_id=wedding-mini-v1&difficulty=medium",
      ),
    );
  });

  it("opens on the provided default difficulty and re-anchors on reopen", async () => {
    apiRequest.mockResolvedValue({ items: [], total: 0 });

    const { rerenderOpen } = renderDialog({ defaultDifficulty: "hard" });

    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(
      "Hard",
    );

    // Wander to another tab, close, reopen: the dialog re-anchors to the
    // solve's own difficulty rather than remembering the wander.
    fireEvent.click(screen.getByRole("button", { name: "Easy" }));
    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(
      "Easy",
    );
    rerenderOpen(false);
    rerenderOpen(true);
    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent(
      "Hard",
    );
  });

  it("omits the truncation footer when every posted solve is shown", async () => {
    apiRequest.mockResolvedValue({
      items: [
        {
          display_name: "Alice",
          difficulty: "easy",
          elapsed_ms: 61_000,
          completed_at: "2026-06-10T00:00:00Z",
        },
        {
          display_name: "Bob",
          difficulty: "hard",
          elapsed_ms: 95_000,
          completed_at: "2026-06-11T00:00:00Z",
        },
      ],
      total: 2,
    });

    renderDialog();

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText(/showing the fastest/i)).not.toBeInTheDocument();
  });

  it("passes the session id through to the read", async () => {
    apiRequest.mockResolvedValue({ items: [], total: 0, viewer: null });

    renderDialog({ sessionId: "sess-7" });

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "/games/leaderboard?puzzle_id=wedding-mini-v1&difficulty=easy&session_id=sess-7",
      ),
    );
  });

  it("highlights the viewer's row in place when it is within the list", async () => {
    apiRequest.mockResolvedValue({
      items: [
        {
          display_name: "Alice",
          difficulty: "easy",
          elapsed_ms: 61_000,
          completed_at: "2026-06-10T00:00:00Z",
        },
        {
          display_name: "Robin",
          difficulty: "easy",
          elapsed_ms: 90_000,
          completed_at: "2026-06-11T00:00:00Z",
        },
      ],
      total: 2,
      viewer: {
        rank: 2,
        entry: {
          display_name: "Robin",
          difficulty: "easy",
          elapsed_ms: 90_000,
          completed_at: "2026-06-11T00:00:00Z",
        },
      },
    });

    renderDialog({ sessionId: "sess-7" });

    const rows = await screen.findAllByRole("listitem");
    // No appended duplicate: the in-list row carries the marker instead.
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent("Robin");
    expect(within(rows[1]).getByText("You")).toBeInTheDocument();
    expect(screen.getAllByText("You")).toHaveLength(1);
  });

  it("appends the viewer's row with its true rank when it falls past the list", async () => {
    apiRequest.mockResolvedValue({
      items: [
        {
          display_name: "Alice",
          difficulty: "easy",
          elapsed_ms: 61_000,
          completed_at: "2026-06-10T00:00:00Z",
        },
        {
          display_name: "Bob",
          difficulty: "easy",
          elapsed_ms: 70_000,
          completed_at: "2026-06-11T00:00:00Z",
        },
      ],
      total: 137,
      viewer: {
        rank: 42,
        entry: {
          display_name: "Robin",
          difficulty: "easy",
          elapsed_ms: 600_000,
          completed_at: "2026-06-12T00:00:00Z",
        },
      },
    });

    renderDialog({ sessionId: "sess-7" });

    const rows = await screen.findAllByRole("listitem");
    // The two displayed plus the appended off-list viewer row.
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent("42.");
    expect(rows[2]).toHaveTextContent("Robin");
    expect(within(rows[2]).getByText("You")).toBeInTheDocument();
    expect(screen.getAllByText("You")).toHaveLength(1);
    // The truncation footer still reflects items vs total.
    expect(
      screen.getByText(/showing the fastest 2 of 137/i),
    ).toBeInTheDocument();
  });

  it("renders no viewer marker when the read returns no viewer", async () => {
    apiRequest.mockResolvedValue({
      items: [
        {
          display_name: "Alice",
          difficulty: "easy",
          elapsed_ms: 61_000,
          completed_at: "2026-06-10T00:00:00Z",
        },
      ],
      total: 1,
      viewer: null,
    });

    renderDialog({ sessionId: "sess-7" });

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("You")).not.toBeInTheDocument();
  });

  it("renders every returned row inside a single scrollable list (show-all, no client truncation)", async () => {
    // More rows than fit on screen: the model is show-all, so the dialog
    // renders all of them and lets the list, not the dialog, scroll.
    const items = Array.from({ length: 130 }, (_, i) =>
      entry({ display_name: `Solver ${i + 1}`, elapsed_ms: 60_000 + i }),
    );
    apiRequest.mockResolvedValue({ items, total: 130 });

    renderDialog();

    // Every entry is present (the first, a middle one, and the last) with no
    // "showing N of M" truncation, since items === total at wedding scale.
    expect(await screen.findByText("Solver 1")).toBeInTheDocument();
    expect(screen.getByText("Solver 65")).toBeInTheDocument();
    expect(screen.getByText("Solver 130")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(130);
    expect(screen.queryByText(/showing the fastest/i)).not.toBeInTheDocument();

    // The list is its own bounded scrollport (the dialog stays put; the list
    // scrolls), the same containment the clue lists use.
    const list = screen.getByTestId("crossword-leaderboard-list");
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(list.className).toMatch(/max-h-/);
  });

  it("gives the top three a podium treatment and leaves the rest plain", async () => {
    apiRequest.mockResolvedValue({
      items: [
        entry({ display_name: "First", elapsed_ms: 60_000 }),
        entry({ display_name: "Second", elapsed_ms: 61_000 }),
        entry({ display_name: "Third", elapsed_ms: 62_000 }),
        entry({ display_name: "Fourth", elapsed_ms: 63_000 }),
      ],
      total: 4,
    });

    renderDialog();

    const rows = await screen.findAllByRole("listitem");
    // Ranks 1-3 carry a labelled podium medal; rank 4 does not.
    expect(within(rows[0]).getByLabelText(/1st place/i)).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText(/2nd place/i)).toBeInTheDocument();
    expect(within(rows[2]).getByLabelText(/3rd place/i)).toBeInTheDocument();
    expect(within(rows[3]).queryByLabelText(/place/i)).not.toBeInTheDocument();
    // Rank 4 still shows its plain number.
    expect(rows[3]).toHaveTextContent("4.");
  });

  it("composes the podium medal with the 'You' badge when the viewer is in the top three", async () => {
    apiRequest.mockResolvedValue({
      items: [
        entry({ display_name: "Alice", elapsed_ms: 60_000 }),
        entry({ display_name: "Robin", elapsed_ms: 61_000 }),
        entry({ display_name: "Carol", elapsed_ms: 62_000 }),
      ],
      total: 3,
      viewer: {
        rank: 2,
        entry: entry({ display_name: "Robin", elapsed_ms: 61_000 }),
      },
    });

    renderDialog({ sessionId: "sess-7" });

    const rows = await screen.findAllByRole("listitem");
    // The viewer's silver row reads as both second place and "You", with no
    // appended duplicate.
    expect(within(rows[1]).getByLabelText(/2nd place/i)).toBeInTheDocument();
    expect(within(rows[1]).getByText("You")).toBeInTheDocument();
    expect(screen.getAllByText("You")).toHaveLength(1);
  });

  it("keeps the viewer row's box model identical to a normal row so columns stay aligned", async () => {
    // The highlight must not change the row's padding: every row carries the
    // same px/py, and the viewer is marked by a background + ring only. This
    // pins the alignment fix so a future regression that reintroduces shifting
    // padding on the highlighted row is caught.
    apiRequest.mockResolvedValue({
      items: [
        entry({ display_name: "Alice", elapsed_ms: 61_000 }),
        entry({ display_name: "Bob", elapsed_ms: 62_000 }),
        entry({ display_name: "Carol", elapsed_ms: 63_000 }),
        entry({ display_name: "Robin", elapsed_ms: 64_000 }),
      ],
      total: 4,
      viewer: {
        rank: 4,
        entry: entry({ display_name: "Robin", elapsed_ms: 64_000 }),
      },
    });

    renderDialog({ sessionId: "sess-7" });

    const rows = await screen.findAllByRole("listitem");
    const normalRow = rows[3 - 1]; // rank 3, a plain non-podium, non-viewer row
    const viewerRow = rows[4 - 1]; // rank 4, the highlighted "You" row
    expect(within(viewerRow).getByText("You")).toBeInTheDocument();

    // Both rows share the same horizontal and vertical padding (same box
    // model), so the rank/name/time columns line up across them.
    for (const cls of ["px-2", "py-1"]) {
      expect(normalRow).toHaveClass(cls);
      expect(viewerRow).toHaveClass(cls);
    }
    // The viewer's distinction is a background + ring, not extra padding.
    expect(viewerRow).toHaveClass("bg-secondary/40");
    expect(viewerRow.className).toMatch(/ring-1/);
    expect(normalRow).not.toHaveClass("bg-secondary/40");
  });

  it("scrolls its own scrollport to center the viewer's row on open", async () => {
    // The viewer ranks deep in the list (below the scrollport), as a guest who
    // placed, say, 80th would. jsdom has no layout, so (as in the clue-list
    // test) the list renders first with the effect inert, the geometry is
    // pinned on the persisted row node, then the viewer arrives to fire the
    // effect against it. Here the warm-up read has no viewer (the inert state)
    // and the viewer-aware read adds the solver's own row at rank 80.
    const items = Array.from({ length: 100 }, (_, i) =>
      entry({ display_name: `Solver ${i + 1}`, elapsed_ms: 60_000 + i }),
    );
    apiRequest.mockResolvedValue({ items, total: 100, viewer: null });

    const { queryClient } = renderDialog({ sessionId: "sess-7" });
    await screen.findByText("Solver 80");

    // The viewer's row (rank 80, "Solver 80") sits well below the 0-100
    // scrollport (top 800-820); pin that before the viewer arrives.
    const scrollTo = mockListGeometry(rect(800, 820), {
      targetText: "Solver 80",
    });
    expect(scrollTo).not.toHaveBeenCalled();

    // The viewer-aware response lands with the SAME items (so the row node
    // persists and keeps its pinned rect) plus the solver's rank, firing the
    // effect: centering brings the row's middle (810) to the scrollport's
    // middle (50), i.e. scrollTop 760.
    queryClient.setQueryData(
      [QueryKey.GameLeaderboard, "wedding-mini-v1", "easy", "sess-7"],
      { items, total: 100, viewer: { rank: 80, entry: items[79] } },
    );

    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 760 });
  });

  it("measures on the next frame, not synchronously, so a reopened portal has laid out", async () => {
    // The scroll is deferred to an animation frame because the dialog's Radix
    // portal remounts the list on each open: measuring in the effect body
    // reads a not-yet-mounted scrollport on a reopen and silently no-ops. Pin
    // the deferral by capturing the frame callback instead of running it.
    let frameCb: FrameRequestCallback | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      frameCb = cb;
      return 1;
    });

    const items = Array.from({ length: 100 }, (_, i) =>
      entry({ display_name: `Solver ${i + 1}`, elapsed_ms: 60_000 + i }),
    );
    apiRequest.mockResolvedValue({ items, total: 100, viewer: null });

    const { queryClient } = renderDialog({ sessionId: "sess-7" });
    await screen.findByText("Solver 80");
    const scrollTo = mockListGeometry(rect(800, 820), {
      targetText: "Solver 80",
    });

    queryClient.setQueryData(
      [QueryKey.GameLeaderboard, "wedding-mini-v1", "easy", "sess-7"],
      { items, total: 100, viewer: { rank: 80, entry: items[79] } },
    );

    // A frame was requested, but nothing scrolled until it runs.
    await waitFor(() => expect(frameCb).not.toBeNull());
    expect(scrollTo).not.toHaveBeenCalled();
    frameCb!(0);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "auto", top: 760 });
  });

  it("does not auto-scroll on tabs that have no viewer", async () => {
    // A board that is not the solver's own difficulty returns no viewer.
    const items = Array.from({ length: 100 }, (_, i) =>
      entry({ display_name: `Solver ${i + 1}`, elapsed_ms: 60_000 + i }),
    );
    apiRequest.mockResolvedValue({ items, total: 100, viewer: null });

    renderDialog({ sessionId: "sess-7" });
    await screen.findByText("Solver 1");

    // No "You" row to anchor on, so spy on the scrollport directly: with no
    // viewer the effect must not move it at all.
    const list = screen.getByTestId("crossword-leaderboard-list");
    const scrollTo = vi.fn();
    Object.assign(list, { scrollTo });
    list.getBoundingClientRect = () => rect(0, 100);

    // Give React a chance to run any effect, then assert nothing scrolled.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not scroll when the viewer's row is already visible (podium on open)", async () => {
    apiRequest.mockResolvedValue({
      items: [
        entry({ display_name: "Robin", elapsed_ms: 60_000 }),
        entry({ display_name: "Alice", elapsed_ms: 61_000 }),
      ],
      total: 2,
      viewer: {
        rank: 1,
        entry: entry({ display_name: "Robin", elapsed_ms: 60_000 }),
      },
    });

    renderDialog({ sessionId: "sess-7" });
    await screen.findByText("Robin");

    // The viewer's row is fully within the 0-100 scrollport (top 0-20), so
    // centering is suppressed: a podium finisher is not yanked downward.
    const scrollTo = mockListGeometry(rect(0, 20));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
