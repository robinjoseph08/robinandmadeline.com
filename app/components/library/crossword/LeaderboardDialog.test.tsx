// The leaderboard dialog's secondary states: loading, error, empty, the
// truncation footer, and the difficulty tabs' fetch and default behavior,
// plus the show-all list (every returned row rendered inside the single
// flex-fill scroll container), the podium treatment for the top three, and the
// open-time auto-scroll to the viewer's own row. The auto-scroll, like the clue
// list's, cannot run through real layout in jsdom, so it is pinned with mocked
// rects: the viewer row is centered in the list's OWN scroll container (a bare
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
 * scroll container at 0-100, plus a scrollTo spy, so the open-time auto-scroll
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

    // The list is the dialog's ONE scroll container: a flex-fill wrapper that
    // takes the height left under the fixed tabs (flex-1 + min-h-0) and scrolls.
    // It is NOT a second, fixed-height (max-h-[22rem]) scroller nested inside
    // the dialog body's own scroller, which used to clip the list's last row
    // below the body's edge on a short viewport and leave the final rank
    // unreachable. min-h-0 lets it shrink past its content so it, not the body,
    // owns the scroll; a regression back to a fixed height reintroduces the
    // nested-scroller clip.
    const scroller = screen.getByTestId("crossword-leaderboard-list");
    expect(scroller.className).toMatch(/overflow-y-auto/);
    expect(scroller.className).toMatch(/(^|\s)flex-1(\s|$)/);
    expect(scroller.className).toMatch(/(^|\s)min-h-0(\s|$)/);
    // The scroller fills the dialog rather than capping itself, so no max-height
    // windows it independently of the body (the old nested-scroll bug).
    expect(scroller.className).not.toMatch(/max-h-/);
    // Horizontal padding is symmetric (px-1, not pr-1) so the highlighted
    // viewer row's ring is not clipped on the left by the scroll container's
    // overflow; reverting to right-only padding reintroduces that clip.
    expect(scroller.className).toMatch(/(^|\s)px-1(\s|$)/);
    // Vertical padding gives the first and last rows breathing room inside the
    // scroll range, so the last row (and its ring) is fully visible when
    // scrolled to the bottom instead of sitting flush against the overflow edge
    // with its time clipped; dropping it reintroduces that clip.
    expect(scroller.className).toMatch(/(^|\s)py-1\.5(\s|$)/);

    // The <ol> inside the scroller is natural height now (it no longer windows
    // itself): it carries neither a max-height nor its own overflow, so the
    // single wrapper above is the only thing that scrolls.
    const ol = scroller.querySelector("ol")!;
    expect(ol.className).not.toMatch(/max-h-/);
    expect(ol.className).not.toMatch(/overflow-/);
  });

  it("gives the top three a place trophy and leaves the rest plain", async () => {
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
    // Ranks 1-3 carry a labelled place marker; rank 4 does not.
    expect(within(rows[0]).getByLabelText(/1st place/i)).toBeInTheDocument();
    expect(within(rows[1]).getByLabelText(/2nd place/i)).toBeInTheDocument();
    expect(within(rows[2]).getByLabelText(/3rd place/i)).toBeInTheDocument();
    expect(within(rows[3]).queryByLabelText(/place/i)).not.toBeInTheDocument();
    // The marker is specifically the trophy glyph (not just any place styling),
    // so swapping the icon back out is caught; the plain rank has none.
    expect(within(rows[0]).getByTestId("podium-trophy")).toBeInTheDocument();
    expect(within(rows[2]).getByTestId("podium-trophy")).toBeInTheDocument();
    expect(
      within(rows[3]).queryByTestId("podium-trophy"),
    ).not.toBeInTheDocument();
    // Every row, podium or plain, shows its rank as the same "{rank}." text.
    expect(rows[0]).toHaveTextContent("1.");
    expect(rows[3]).toHaveTextContent("4.");
  });

  it("tints podium rows with their place color and leaves plain rows untinted", async () => {
    // The redesign mirrors the blue "You" highlight in metal: each top-three
    // row wears a place-colored background + ring (gold/silver/bronze), so a
    // podium row reads as a place-colored sibling of the viewer's highlight
    // rather than a separate badge. A plain row carries neither tint. This pins
    // the row-level treatment so a regression back to a standalone gutter widget
    // (no row tint) is caught.
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
    // Gold, silver, bronze row tints, each with a ring like the "You" row.
    expect(rows[0]).toHaveClass("bg-amber-300/45");
    expect(rows[1]).toHaveClass("bg-slate-300/55");
    expect(rows[2]).toHaveClass("bg-orange-300/45");
    for (const podiumRow of [rows[0], rows[1], rows[2]]) {
      expect(podiumRow.className).toMatch(/ring-1/);
    }
    // The plain row (rank 4) carries no place tint and no blue viewer tint.
    expect(rows[3]).not.toHaveClass("bg-amber-300/45");
    expect(rows[3]).not.toHaveClass("bg-secondary/40");
    expect(rows[3].className).not.toMatch(/ring-1/);
  });

  it("renders the rank number identically on podium and plain rows so they stay aligned", async () => {
    // The rank number is the same muted, right-aligned, tabular "{rank}." on
    // every row; only the trophy to its left changes for the podium. The number
    // sits in a fixed-width, right-justified unit so the periods (and the names
    // after them) form one column down the whole list, podium rows included.
    // This pins that so a regression that styles the podium number differently,
    // or folds it into the trophy, is caught.
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
    // Find each row's rank-number span by its text and compare the class lists:
    // a podium row (rank 1) and a plain row (rank 4) must render the number the
    // same way (alignment, muted color, tabular figures), so a podium-only
    // restyle of the number that would knock the column out of line is caught.
    const podiumNumber = within(rows[0]).getByText("1.");
    const plainNumber = within(rows[3]).getByText("4.");
    expect(podiumNumber.className).toBe(plainNumber.className);
    for (const cls of ["text-right", "text-muted-foreground", "tabular-nums"]) {
      expect(podiumNumber).toHaveClass(cls);
    }
    // The trophy is a sibling of the number inside the shared rank unit, never
    // an ancestor that absorbs it, so the number stays its own aligned column.
    const trophy = within(rows[0]).getByTestId("podium-trophy");
    expect(trophy).not.toContainElement(podiumNumber);
    const rankUnit = podiumNumber.parentElement!;
    expect(rankUnit).toContainElement(trophy);
    // The rank unit is the fixed-width, right-justified slot that aligns the
    // numbers; the same slot wraps the plain row's number (no trophy beside it).
    expect(rankUnit).toHaveClass("w-16", "shrink-0", "justify-end");
    expect(plainNumber.parentElement).toHaveClass("w-16", "justify-end");
  });

  it("colors a top-three viewer's row and 'You' badge to the place, never blue", async () => {
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
    const badge = within(rows[1]).getByText("You");
    expect(screen.getAllByText("You")).toHaveLength(1);
    // A top-three viewer is the place color throughout, with zero blue: the row
    // wears the silver tint (not the blue secondary), and the "You" badge is the
    // silver pill (not the blue secondary badge).
    expect(rows[1]).toHaveClass("bg-slate-300/55");
    expect(rows[1]).not.toHaveClass("bg-secondary/40");
    expect(badge).toHaveClass("bg-slate-400", "text-slate-950");
    expect(badge).not.toHaveClass("bg-secondary");
    expect(badge).not.toHaveClass("text-secondary-foreground");
  });

  it("keeps a non-podium viewer's row and 'You' badge blue", async () => {
    // The viewer outside the top three keeps the original blue treatment: a
    // blue row tint + ring and a blue "You" badge. This pins the split so the
    // place coloring never leaks onto a plain-ranked viewer (and the blue never
    // leaks onto a podium viewer, covered above).
    apiRequest.mockResolvedValue({
      items: [
        entry({ display_name: "Alice", elapsed_ms: 60_000 }),
        entry({ display_name: "Bob", elapsed_ms: 61_000 }),
        entry({ display_name: "Carol", elapsed_ms: 62_000 }),
        entry({ display_name: "Robin", elapsed_ms: 63_000 }),
      ],
      total: 4,
      viewer: {
        rank: 4,
        entry: entry({ display_name: "Robin", elapsed_ms: 63_000 }),
      },
    });

    renderDialog({ sessionId: "sess-7" });

    const rows = await screen.findAllByRole("listitem");
    const badge = within(rows[3]).getByText("You");
    // Rank 4 is not a podium row, so no place marker rides it.
    expect(within(rows[3]).queryByLabelText(/place/i)).not.toBeInTheDocument();
    // Blue row tint and blue badge, with no place tint leaking in.
    expect(rows[3]).toHaveClass("bg-secondary/40");
    expect(rows[3].className).toMatch(/ring-1/);
    expect(rows[3]).not.toHaveClass("bg-orange-300/45");
    expect(badge).toHaveClass("bg-secondary", "text-secondary-foreground");
    expect(badge).not.toHaveClass("bg-orange-400");
  });

  it("keeps the viewer row's box model identical to a normal row so columns stay aligned", async () => {
    // The highlight must not change the row's padding: every row carries the
    // same px/py, and the viewer is marked by a background + ring only. This
    // pins the alignment fix so a future regression that reintroduces shifting
    // padding on the highlighted row is caught.
    // Five entries so the normal row compared against is genuinely plain: the
    // podium covers ranks 1-3 and the viewer is rank 5, leaving rank 4 as the
    // one row that is neither a podium row nor the viewer. (A 4-entry fixture
    // would make rank 3 the bronze podium and rank 4 the viewer, so the old
    // "pad only podium/viewer rows" bug would slip through.)
    apiRequest.mockResolvedValue({
      items: [
        entry({ display_name: "Alice", elapsed_ms: 61_000 }),
        entry({ display_name: "Bob", elapsed_ms: 62_000 }),
        entry({ display_name: "Carol", elapsed_ms: 63_000 }),
        entry({ display_name: "Dave", elapsed_ms: 64_000 }),
        entry({ display_name: "Robin", elapsed_ms: 65_000 }),
      ],
      total: 5,
      viewer: {
        rank: 5,
        entry: entry({ display_name: "Robin", elapsed_ms: 65_000 }),
      },
    });

    renderDialog({ sessionId: "sess-7" });

    const rows = await screen.findAllByRole("listitem");
    const normalRow = rows[4 - 1]; // rank 4, a plain non-podium, non-viewer row
    const viewerRow = rows[5 - 1]; // rank 5, the highlighted "You" row
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

  it("scrolls its own container to center the viewer's row on open", async () => {
    // The viewer ranks deep in the list (below the scroll container), as a guest
    // who placed, say, 80th would. jsdom has no layout, so (as in the clue-list
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
    // scroll container (top 800-820); pin that before the viewer arrives.
    const scrollTo = mockListGeometry(rect(800, 820), {
      targetText: "Solver 80",
    });
    expect(scrollTo).not.toHaveBeenCalled();

    // The viewer-aware response lands with the SAME items (so the row node
    // persists and keeps its pinned rect) plus the solver's rank, firing the
    // effect: centering brings the row's middle (810) to the container's
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
    // reads a not-yet-mounted scroll container on a reopen and silently no-ops.
    // Pin the deferral by capturing the frame callback instead of running it.
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

    // No "You" row to anchor on, so spy on the scroll container directly: with
    // no viewer the effect must not move it at all.
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

    // The viewer's row is fully within the 0-100 scroll container (top 0-20),
    // so centering is suppressed: a podium finisher is not yanked downward.
    const scrollTo = mockListGeometry(rect(0, 20));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
