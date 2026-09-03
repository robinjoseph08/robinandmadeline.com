import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
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
    square_checks: 0,
    word_checks: 0,
    grid_checks: 0,
    completed_at: undefined,
    on_leaderboard: false,
    display_name: undefined,
    hidden_at: undefined,
    party_id: undefined,
    party_name: undefined,
    ip_address: "203.0.113.1",
    user_agent: "Mozilla/5.0 TestBrowser/1.0",
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
          user_agent: "Mozilla/5.0 Chrome/126.0",
          square_checks: 2,
          word_checks: 1,
          grid_checks: 3,
        }),
        // Admin-hidden: name retained, but no longer publicly listed.
        makeSession({
          id: "s-hidden",
          difficulty: "easy",
          elapsed_ms: 90000,
          completed_at: "2026-06-02T15:30:00Z",
          on_leaderboard: false,
          display_name: "Robin",
          hidden_at: "2026-06-02T15:31:00Z",
          ip_address: "203.0.113.15",
          user_agent: "Mozilla/5.0 Safari/17.5",
        }),
        // Completed but never posted: no display name, anonymous, no party.
        makeSession({
          id: "s-completed",
          difficulty: "medium",
          elapsed_ms: 125000,
          completed_at: "2026-06-02T16:00:00Z",
          on_leaderboard: false,
          ip_address: "203.0.113.20",
          user_agent: "Mozilla/5.0 Firefox/127.0",
        }),
        // In progress / abandoned: no completed_at.
        makeSession({
          id: "s-progress",
          elapsed_ms: 5000,
          completed_at: undefined,
          ip_address: "203.0.113.30",
          user_agent: "CrosswordBot/1.0",
        }),
      ],
      total: 4,
    });

    renderCrossword();

    // Status badges, one per state.
    expect(await screen.findByText("On leaderboard")).toBeInTheDocument();
    expect(screen.getByText("Hidden")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();

    // Solver name: display_name when set, otherwise the Anonymous fallback.
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Robin")).toBeInTheDocument();
    // The completed-unposted and in-progress rows are both anonymous.
    const anonymous = screen.getAllByText("Anonymous");
    expect(anonymous).toHaveLength(2);
    // The Anonymous fallback reads as a derived placeholder: lightened and
    // italic, not a literal entered name. A named solver renders plainly.
    for (const cell of anonymous) {
      expect(cell).toHaveClass("italic", "opacity-60");
    }
    expect(screen.getByText("Ada")).not.toHaveClass("italic");

    // Party: the party name when affiliated.
    expect(screen.getByText("The Lovelaces")).toBeInTheDocument();

    // Puzzle titles mapped from the id.
    expect(screen.getByText("The Wedding Crossword")).toBeInTheDocument();
    expect(screen.getAllByText("The Wedding Mini")).toHaveLength(3);

    // Difficulty labels.
    expect(screen.getByText("Hard")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getAllByText("Easy")).toHaveLength(2);

    // Times, formatted as the clock readout (hours once past an hour).
    expect(screen.getByText("1:02:03")).toBeInTheDocument();
    expect(screen.getByText("1:30")).toBeInTheDocument();
    expect(screen.getByText("2:05")).toBeInTheDocument();
    expect(screen.getByText("0:05")).toBeInTheDocument();

    // Check use is shown with the separate scope counts retained by the API.
    expect(
      screen.getByRole("columnheader", { name: "Checks" }),
    ).toBeInTheDocument();
    const postedRow = screen.getByText("Ada").closest("tr");
    expect(postedRow).not.toBeNull();
    expect(within(postedRow!).getByText("Square: 2")).toBeInTheDocument();
    expect(within(postedRow!).getByText("Word: 1")).toBeInTheDocument();
    expect(within(postedRow!).getByText("Grid: 3")).toBeInTheDocument();

    // The admin-only Client column pairs IP and user agent in one cell rather
    // than adding another wide table column.
    expect(
      screen.getByRole("columnheader", { name: "Client" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: "IP address" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("203.0.113.10")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.15")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.20")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.30")).toBeInTheDocument();
    expect(screen.getByText("Mozilla/5.0 Chrome/126.0")).toBeInTheDocument();
    expect(screen.getByText("Mozilla/5.0 Safari/17.5")).toBeInTheDocument();
    expect(screen.getByText("Mozilla/5.0 Firefox/127.0")).toBeInTheDocument();
    expect(screen.getByText("CrosswordBot/1.0")).toBeInTheDocument();

    // The header count.
    expect(screen.getByText("4 solve times")).toBeInTheDocument();
  });

  it("shows the completion time for a finished solve and the start time for one still in progress", async () => {
    // The Date cell prefers completed_at and falls back to created_at, so a
    // finished solve reads as when it was finished and an in-progress one as
    // when it started. Distinct months keep the assertion timezone-robust.
    adminRequest.mockResolvedValue({
      items: [
        makeSession({
          id: "s-finished",
          completed_at: "2026-08-20T12:00:00Z",
          created_at: "2026-07-01T12:00:00Z",
        }),
        makeSession({
          id: "s-running",
          completed_at: undefined,
          created_at: "2026-09-05T12:00:00Z",
        }),
      ],
      total: 2,
    });

    renderCrossword();

    // The finished row reflects its completion month (Aug), not its creation
    // month (Jul); the in-progress row falls back to its creation month (Sep).
    expect(await screen.findByText(/Aug.*2026/)).toBeInTheDocument();
    expect(screen.getByText(/Sep.*2026/)).toBeInTheDocument();
    expect(screen.queryByText(/Jul.*2026/)).not.toBeInTheDocument();
  });

  it("shows dashes for a solve with no captured client details", async () => {
    // A request can lack a usable IP or User-Agent, so both lines in the Client
    // cell must read as plain dashes rather than rendering blank.
    adminRequest.mockResolvedValue({
      items: [
        makeSession({ id: "s-no-client", ip_address: "", user_agent: "" }),
      ],
      total: 1,
    });

    renderCrossword();

    await screen.findByText("The Wedding Mini");
    expect(document.body.textContent).not.toContain("—");
    // Four dashes: the empty party, no checks, IP, and user-agent values.
    expect(screen.getAllByText("-")).toHaveLength(4);
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

    // The party and check cells use plain hyphens, never em-dashes.
    const row = (await screen.findByText("Anonymous")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getAllByText("-")).toHaveLength(2);
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

describe("AdminCrossword hide", () => {
  it("hides a public session and refetches the retained row as hidden", async () => {
    let hidden = false;
    adminRequest.mockImplementation((path: string, options?: object) => {
      if (
        path === "/admin/games/sessions/s1/hide" &&
        (options as { method?: string } | undefined)?.method === "POST"
      ) {
        hidden = true;
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        items: [
          makeSession({
            id: "s1",
            completed_at: "2026-06-02T15:00:00Z",
            display_name: "Ada",
            hidden_at: hidden ? "2026-06-02T15:01:00Z" : undefined,
            on_leaderboard: !hidden,
          }),
        ],
        total: 1,
      });
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Hide Ada's time" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Hide Ada's time? They will still see it, but it will no longer appear for other users.",
    );
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/games/sessions/s1/hide",
        { method: "POST" },
      );
    });
    await waitFor(() => expect(screen.getByText("Hidden")).toBeInTheDocument());
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Hide Ada's time" }),
    ).not.toBeInTheDocument();
  });

  it("does nothing when hiding is not confirmed", async () => {
    adminRequest.mockResolvedValue({
      items: [
        makeSession({
          id: "s1",
          completed_at: "2026-06-02T15:00:00Z",
          display_name: "Ada",
          on_leaderboard: true,
        }),
      ],
      total: 1,
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Hide Ada's time" }));

    expect(adminRequest).not.toHaveBeenCalledWith(
      "/admin/games/sessions/s1/hide",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces a toast when hiding fails", async () => {
    adminRequest.mockImplementation((path: string, options?: object) => {
      if (
        path === "/admin/games/sessions/s1/hide" &&
        (options as { method?: string } | undefined)?.method === "POST"
      ) {
        return Promise.reject(new Error("Hide failed"));
      }
      return Promise.resolve({
        items: [
          makeSession({
            id: "s1",
            completed_at: "2026-06-02T15:00:00Z",
            display_name: "Ada",
            on_leaderboard: true,
          }),
        ],
        total: 1,
      });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const errorSpy = vi.spyOn(toast, "error");

    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Hide Ada's time" }));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Hide failed");
    });
    errorSpy.mockRestore();
  });

  it("restores a hidden session and refetches it onto the leaderboard", async () => {
    let hidden = true;
    adminRequest.mockImplementation((path: string, options?: object) => {
      if (
        path === "/admin/games/sessions/s1/unhide" &&
        (options as { method?: string } | undefined)?.method === "POST"
      ) {
        hidden = false;
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        items: [
          makeSession({
            id: "s1",
            completed_at: "2026-06-02T15:00:00Z",
            display_name: "Ada",
            hidden_at: hidden ? "2026-06-02T15:01:00Z" : undefined,
            on_leaderboard: !hidden,
          }),
        ],
        total: 1,
      });
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Hidden");
    await user.click(
      screen.getByRole("button", { name: "Restore Ada's time" }),
    );

    expect(confirmSpy).toHaveBeenCalledWith(
      "Restore Ada's time to the public leaderboard?",
    );
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/games/sessions/s1/unhide",
        { method: "POST" },
      );
    });
    await waitFor(() =>
      expect(screen.getByText("On leaderboard")).toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("button", { name: "Restore Ada's time" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Hide Ada's time" }),
    ).toBeInTheDocument();
  });

  it("does nothing when restoring is not confirmed", async () => {
    adminRequest.mockResolvedValue({
      items: [
        makeSession({
          id: "s1",
          completed_at: "2026-06-02T15:00:00Z",
          display_name: "Ada",
          hidden_at: "2026-06-02T15:01:00Z",
          on_leaderboard: false,
        }),
      ],
      total: 1,
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Hidden");
    await user.click(
      screen.getByRole("button", { name: "Restore Ada's time" }),
    );

    expect(adminRequest).not.toHaveBeenCalledWith(
      "/admin/games/sessions/s1/unhide",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces a toast when restoring fails", async () => {
    adminRequest.mockImplementation((path: string, options?: object) => {
      if (
        path === "/admin/games/sessions/s1/unhide" &&
        (options as { method?: string } | undefined)?.method === "POST"
      ) {
        return Promise.reject(new Error("Restore failed"));
      }
      return Promise.resolve({
        items: [
          makeSession({
            id: "s1",
            completed_at: "2026-06-02T15:00:00Z",
            display_name: "Ada",
            hidden_at: "2026-06-02T15:01:00Z",
            on_leaderboard: false,
          }),
        ],
        total: 1,
      });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const errorSpy = vi.spyOn(toast, "error");

    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Hidden");
    await user.click(
      screen.getByRole("button", { name: "Restore Ada's time" }),
    );

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Restore failed");
    });
    errorSpy.mockRestore();
  });
});
