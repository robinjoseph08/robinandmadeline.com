import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { AdminGameSessionResponse } from "@/types/generated/games";

import AdminCrossword from "./AdminCrossword";

// adminRequest is the single network seam; the tests drive the UI by stubbing
// its responses per call and assert on the requests it receives.
const adminRequest = vi.fn();
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: (...args: unknown[]) => adminRequest(...args),
  };
});

function makeSession(
  overrides: Partial<AdminGameSessionResponse>,
): AdminGameSessionResponse {
  return {
    id: "s1",
    puzzle_id: "wedding-mini-v1",
    difficulty: "easy",
    elapsed_ms: 65000,
    completed_at: undefined,
    on_leaderboard: false,
    display_name: undefined,
    party_id: undefined,
    party_name: undefined,
    ip_address: "203.0.113.1",
    created_at: "2026-06-01T12:00:00Z",
    updated_at: "2026-06-01T12:00:00Z",
    ...overrides,
  };
}

function renderCrossword() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminCrossword />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminCrossword list", () => {
  it("renders sessions of every state with the right status, names, and party", async () => {
    adminRequest.mockResolvedValue({
      items: [
        // Posted: on the leaderboard, with a display name and an affiliated party.
        makeSession({
          id: "s-posted",
          puzzle_id: "wedding-full-v1",
          difficulty: "hard",
          elapsed_ms: 3723000,
          completed_at: "2026-06-02T15:00:00Z",
          on_leaderboard: true,
          display_name: "Ada",
          party_id: "p1",
          party_name: "The Lovelaces",
          ip_address: "203.0.113.10",
        }),
        // Completed but never posted: no display name, anonymous, no party.
        makeSession({
          id: "s-completed",
          difficulty: "medium",
          elapsed_ms: 125000,
          completed_at: "2026-06-02T16:00:00Z",
          on_leaderboard: false,
          ip_address: "203.0.113.20",
        }),
        // In progress / abandoned: no completed_at.
        makeSession({
          id: "s-progress",
          elapsed_ms: 5000,
          completed_at: undefined,
          ip_address: "203.0.113.30",
        }),
      ],
      total: 3,
    });

    renderCrossword();

    // Status badges, one per state.
    expect(await screen.findByText("On leaderboard")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();

    // Solver name: display_name when set, otherwise the Anonymous fallback.
    expect(screen.getByText("Ada")).toBeInTheDocument();
    // The completed-unposted and in-progress rows are both anonymous.
    expect(screen.getAllByText("Anonymous")).toHaveLength(2);

    // Party: the party name when affiliated.
    expect(screen.getByText("The Lovelaces")).toBeInTheDocument();

    // Puzzle titles mapped from the id.
    expect(screen.getByText("The Wedding Crossword")).toBeInTheDocument();
    expect(screen.getAllByText("The Wedding Mini")).toHaveLength(2);

    // Difficulty labels.
    expect(screen.getByText("Hard")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("Easy")).toBeInTheDocument();

    // Times, formatted as the clock readout (hours once past an hour).
    expect(screen.getByText("1:02:03")).toBeInTheDocument();
    expect(screen.getByText("2:05")).toBeInTheDocument();
    expect(screen.getByText("0:05")).toBeInTheDocument();

    // The admin-only IP column.
    expect(screen.getByText("203.0.113.10")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.20")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.30")).toBeInTheDocument();

    // The header count.
    expect(screen.getByText("3 solve times")).toBeInTheDocument();
  });

  it("falls back to the raw puzzle id for an id not in the registry", async () => {
    adminRequest.mockResolvedValue({
      items: [makeSession({ id: "s-unknown", puzzle_id: "retired-puzzle-v0" })],
      total: 1,
    });

    renderCrossword();

    expect(await screen.findByText("retired-puzzle-v0")).toBeInTheDocument();
  });

  it("shows a plain empty indicator for an anonymous solve's party", async () => {
    adminRequest.mockResolvedValue({
      items: [makeSession({ id: "s-anon", party_name: undefined })],
      total: 1,
    });

    renderCrossword();

    // The party cell reads as a plain hyphen, never an em-dash.
    const dash = await screen.findByText("-");
    expect(dash).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("—");
  });
});

describe("AdminCrossword states", () => {
  it("renders the loading state while the list is in flight", () => {
    adminRequest.mockReturnValue(new Promise(() => {}));

    renderCrossword();

    expect(screen.getByText("Loading solve times...")).toBeInTheDocument();
  });

  it("renders the empty state when there are no sessions", async () => {
    adminRequest.mockResolvedValue({ items: [], total: 0 });

    renderCrossword();

    expect(await screen.findByText(/No solve times yet/)).toBeInTheDocument();
  });
});

describe("AdminCrossword delete", () => {
  it("DELETEs the session after confirmation", async () => {
    adminRequest.mockImplementation((path: string, options?: object) => {
      if (
        path === "/admin/games/sessions/s1" &&
        (options as { method?: string } | undefined)?.method === "DELETE"
      ) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        items: [makeSession({ id: "s1", display_name: "Ada" })],
        total: 1,
      });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Delete Ada's time" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/games/sessions/s1", {
        method: "DELETE",
      });
    });
  });

  it("does nothing when the delete is not confirmed", async () => {
    adminRequest.mockResolvedValue({
      items: [makeSession({ id: "s1", display_name: "Ada" })],
      total: 1,
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Delete Ada's time" }));

    // The list read happened, but no DELETE was ever issued.
    expect(adminRequest).not.toHaveBeenCalledWith(
      "/admin/games/sessions/s1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("surfaces a toast when the delete fails", async () => {
    adminRequest.mockImplementation((path: string, options?: object) => {
      if (
        path === "/admin/games/sessions/s1" &&
        (options as { method?: string } | undefined)?.method === "DELETE"
      ) {
        return Promise.reject(new Error("Delete failed"));
      }
      return Promise.resolve({
        items: [makeSession({ id: "s1", display_name: "Ada" })],
        total: 1,
      });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const errorSpy = vi.spyOn(toast, "error");

    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Delete Ada's time" }));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Delete failed");
    });
    errorSpy.mockRestore();
  });
});
