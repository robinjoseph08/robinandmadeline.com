// The leaderboard dialog's secondary states: loading, error, empty, the
// truncation footer, and the difficulty tabs' fetch and default behavior.
// The populated happy path renders through the page in
// Crossword.session.test.tsx.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("LeaderboardDialog", () => {
  beforeEach(() => {
    apiRequest.mockReset();
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
});
