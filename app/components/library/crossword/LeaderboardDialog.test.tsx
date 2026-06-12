// The leaderboard dialog's secondary states: loading, error, empty, and the
// truncation footer. The populated happy path renders through the page in
// Crossword.session.test.tsx.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import LeaderboardDialog from "./LeaderboardDialog";

const apiRequest = vi.fn();
vi.mock("@/libraries/api", async () => {
  const actual = await vi.importActual<object>("@/libraries/api");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  };
});

function renderDialog() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <LeaderboardDialog
        onOpenChange={() => {}}
        open
        puzzleId="wedding-mini-v1"
        puzzleTitle="The Wedding Mini"
      />
    </QueryClientProvider>,
  );
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

    expect(await screen.findByText(/no times posted yet/i)).toBeInTheDocument();
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
