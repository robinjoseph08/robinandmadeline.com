// The leaderboard dialog's secondary states: loading, error, empty, the
// truncation footer, and the difficulty tabs' fetch and default behavior.
// The populated happy path renders through the page in
// Crossword.session.test.tsx.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
}: { defaultDifficulty?: Difficulty; open?: boolean } = {}) {
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

    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
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

    fireEvent.click(screen.getByRole("tab", { name: "Medium" }));

    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
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

    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
      "Hard",
    );

    // Wander to another tab, close, reopen: the dialog re-anchors to the
    // solve's own difficulty rather than remembering the wander.
    fireEvent.click(screen.getByRole("tab", { name: "Easy" }));
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
      "Easy",
    );
    rerenderOpen(false);
    rerenderOpen(true);
    expect(screen.getByRole("tab", { selected: true })).toHaveTextContent(
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
});
