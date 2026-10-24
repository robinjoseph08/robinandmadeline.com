import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { AdminGameSessionResponse } from "@/types/generated/games";

import AdminCrossword from "./AdminCrossword";

// adminRequest is the single network seam; the tests drive the UI by stubbing
// its responses per call and assert on the requests it receives. The party
// picker's list read is answered separately by partiesRequest, so each test's
// adminRequest stub only has to describe the sessions endpoints.
const adminRequest = vi.fn();
const partiesRequest = vi.fn();
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: (path: string, ...rest: unknown[]) =>
      path === "/admin/parties"
        ? partiesRequest(path, ...rest)
        : adminRequest(path, ...rest),
  };
});

const PARTIES = [
  { id: "p-lovelace", name: "The Lovelaces" },
  { id: "p-babbage", name: "The Babbages" },
];

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
    client_browser: "",
    client_os: "",
    client_device: "",
    ip_city: "",
    ip_region: "",
    ip_country: "",
    ip_org: "",
    ip_geo_pending: false,
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
  partiesRequest.mockReset();
  partiesRequest.mockResolvedValue({ items: PARTIES, total: PARTIES.length });
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
    // Five dashes: the empty party, no checks, IP, user-agent, and location.
    expect(screen.getAllByText("-")).toHaveLength(5);
  });

  it("summarizes a parsed user agent and keeps the raw one in the tooltip", async () => {
    const raw =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) Version/18.1 Mobile/15E148 Safari/604.1";
    adminRequest.mockResolvedValue({
      items: [
        makeSession({
          id: "s-parsed",
          user_agent: raw,
          client_browser: "Safari 18",
          client_os: "iOS 18.1",
          client_device: "iPhone",
        }),
      ],
      total: 1,
    });

    renderCrossword();

    const summary = await screen.findByText("iPhone · iOS 18.1 · Safari 18");
    expect(summary).toHaveAttribute("title", raw);
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
  });

  it("shows the IP location and network owner", async () => {
    adminRequest.mockResolvedValue({
      items: [
        makeSession({
          id: "s-geo",
          ip_city: "Raleigh",
          ip_region: "North Carolina",
          ip_country: "US",
          ip_org: "AS7922 Comcast Cable Communications, LLC",
        }),
      ],
      total: 1,
    });

    renderCrossword();

    expect(
      await screen.findByText("Raleigh, North Carolina"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("US · Comcast Cable Communications, LLC"),
    ).toHaveAttribute("title", "AS7922 Comcast Cable Communications, LLC");
  });

  it("marks a location that is still being looked up", async () => {
    adminRequest.mockResolvedValue({
      items: [makeSession({ id: "s-pending", ip_geo_pending: true })],
      total: 1,
    });

    renderCrossword();

    expect(await screen.findByText("Looking up...")).toBeInTheDocument();
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

    // The party, check, and location cells use plain hyphens, never em-dashes.
    const row = (await screen.findByText("Anonymous")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getAllByText("-")).toHaveLength(3);
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

describe("AdminCrossword edit mode", () => {
  /**
   * A stateful sessions API: one posted solve (s1, "Ada") whose name and party
   * follow the rename and party writes, so the refetch shows the saved values.
   */
  function mockEditableSession(
    initial: { name?: string; partyId?: string } = { name: "Ada" },
    failures: { rename?: string; party?: string } = {},
  ) {
    const state = { ...initial };
    adminRequest.mockImplementation((path: string, options?: object) => {
      const body = (options as { body?: Record<string, string> } | undefined)
        ?.body;
      if (path === "/admin/games/sessions/s1/rename") {
        if (failures.rename) return Promise.reject(new Error(failures.rename));
        state.name = body!.display_name;
        return Promise.resolve(undefined);
      }
      if (path === "/admin/games/sessions/s1/party") {
        if (failures.party) return Promise.reject(new Error(failures.party));
        state.partyId = body!.party_id;
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        items: [
          makeSession({
            id: "s1",
            completed_at: "2026-06-02T15:00:00Z",
            display_name: state.name,
            on_leaderboard: state.name !== undefined,
            party_id: state.partyId,
            party_name: PARTIES.find((p) => p.id === state.partyId)?.name,
          }),
        ],
        total: 1,
      });
    });
  }

  function sessionWrites() {
    return adminRequest.mock.calls.filter(
      ([path]) =>
        typeof path === "string" &&
        (path.endsWith("/rename") || path.endsWith("/party")),
    );
  }

  it("keeps rows read-only until the pencil is clicked", async () => {
    mockEditableSession({ name: "Ada", partyId: "p-lovelace" });
    const user = userEvent.setup();
    renderCrossword();

    const row = (await screen.findByText("Ada")).closest("tr")!;
    expect(within(row).getByText("The Lovelaces")).toBeInTheDocument();
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(row).queryByRole("combobox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));

    expect(
      within(row).getByRole("textbox", { name: "Name for Ada's solve" }),
    ).toHaveValue("Ada");
    expect(
      within(row).getByRole("combobox", { name: "Party for Ada's solve" }),
    ).toHaveTextContent("The Lovelaces");
    // The moderation action steps aside while the row is being edited.
    expect(
      screen.queryByRole("button", { name: "Hide Ada's time" }),
    ).not.toBeInTheDocument();
  });

  it("saves a new name and party together", async () => {
    mockEditableSession();
    const successSpy = vi.spyOn(toast, "success");
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    const name = screen.getByRole("textbox", { name: "Name for Ada's solve" });
    await user.clear(name);
    await user.type(name, "  Ada Lovelace  ");
    await user.click(
      screen.getByRole("combobox", { name: "Party for Ada's solve" }),
    );
    await user.click(await screen.findByRole("option", { name: /Babbages/ }));
    await user.click(screen.getByRole("button", { name: "Save Ada's solve" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/games/sessions/s1/rename",
        { method: "POST", body: { display_name: "Ada Lovelace" } },
      );
    });
    expect(adminRequest).toHaveBeenCalledWith(
      "/admin/games/sessions/s1/party",
      { method: "POST", body: { party_id: "p-babbage" } },
    );
    const row = (await screen.findByText("Ada Lovelace")).closest("tr")!;
    expect(within(row).getByText("The Babbages")).toBeInTheDocument();
    expect(within(row).queryByRole("textbox")).not.toBeInTheDocument();
    expect(successSpy).toHaveBeenCalledWith("Solve updated");
    successSpy.mockRestore();
  });

  it("saves with Enter and sends only what changed", async () => {
    mockEditableSession({ name: "Ada", partyId: "p-lovelace" });
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    const name = screen.getByRole("textbox", { name: "Name for Ada's solve" });
    await user.clear(name);
    await user.type(name, "Ada L{Enter}");

    expect(await screen.findByText("Ada L")).toBeInTheDocument();
    expect(sessionWrites()).toEqual([
      [
        "/admin/games/sessions/s1/rename",
        { method: "POST", body: { display_name: "Ada L" } },
      ],
    ]);
  });

  it("clears a party", async () => {
    mockEditableSession({ name: "Ada", partyId: "p-lovelace" });
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    await user.click(
      screen.getByRole("button", { name: "Clear Party for Ada's solve" }),
    );
    await user.click(screen.getByRole("button", { name: "Save Ada's solve" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/games/sessions/s1/party",
        { method: "POST", body: { party_id: undefined } },
      );
    });
    const row = (await screen.findByText("Ada")).closest("tr")!;
    await waitFor(() =>
      expect(within(row).queryByText("The Lovelaces")).not.toBeInTheDocument(),
    );
  });

  it("edits only the party of an unposted solve", async () => {
    mockEditableSession({});
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Anonymous");
    await user.click(
      screen.getByRole("button", { name: "Edit Anonymous's solve" }),
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("combobox", { name: "Party for Anonymous's solve" }),
    );
    await user.click(await screen.findByRole("option", { name: /Lovelaces/ }));
    await user.click(
      screen.getByRole("button", { name: "Save Anonymous's solve" }),
    );

    expect(await screen.findByText("The Lovelaces")).toBeInTheDocument();
    expect(sessionWrites()).toEqual([
      [
        "/admin/games/sessions/s1/party",
        { method: "POST", body: { party_id: "p-lovelace" } },
      ],
    ]);
  });

  it("discards the draft on cancel or Escape", async () => {
    mockEditableSession();
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    await user.type(
      screen.getByRole("textbox", { name: "Name for Ada's solve" }),
      " Draft",
    );
    await user.click(screen.getByRole("button", { name: "Cancel editing" }));
    expect(screen.getByText("Ada")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    await user.type(
      screen.getByRole("textbox", { name: "Name for Ada's solve" }),
      " Draft{Escape}",
    );
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(sessionWrites()).toEqual([]);
  });

  it("blocks a blank name without sending anything", async () => {
    mockEditableSession();
    const errorSpy = vi.spyOn(toast, "error");
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    await user.clear(
      screen.getByRole("textbox", { name: "Name for Ada's solve" }),
    );
    await user.click(screen.getByRole("button", { name: "Save Ada's solve" }));

    expect(errorSpy).toHaveBeenCalledWith("Name can't be blank");
    expect(sessionWrites()).toEqual([]);
    expect(
      screen.getByRole("textbox", { name: "Name for Ada's solve" }),
    ).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it("stays in edit mode with a toast when saving fails", async () => {
    mockEditableSession({ name: "Ada" }, { rename: "Rename failed" });
    const errorSpy = vi.spyOn(toast, "error");
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    const name = screen.getByRole("textbox", { name: "Name for Ada's solve" });
    await user.clear(name);
    await user.type(name, "Ada L");
    await user.click(screen.getByRole("button", { name: "Save Ada's solve" }));

    await waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith("Rename failed");
    });
    expect(
      screen.getByRole("textbox", { name: "Name for Ada's solve" }),
    ).toHaveValue("Ada L");
    errorSpy.mockRestore();
  });

  it("leaves edit mode without a request or toast when nothing changed", async () => {
    mockEditableSession({ name: "Ada", partyId: "p-lovelace" });
    const successSpy = vi.spyOn(toast, "success");
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    await user.click(screen.getByRole("button", { name: "Save Ada's solve" }));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(sessionWrites()).toEqual([]);
    expect(successSpy).not.toHaveBeenCalled();
    successSpy.mockRestore();
  });

  it("sends the name and party writes in parallel", async () => {
    mockEditableSession();
    // Hold both writes open: each must already be in flight before either
    // settles, which a sequential save would fail (it awaits the first).
    const pending: Array<() => void> = [];
    const listResponse = adminRequest.getMockImplementation()!;
    adminRequest.mockImplementation((path: string, options?: object) =>
      path.endsWith("/rename") || path.endsWith("/party")
        ? new Promise((resolve) => {
            pending.push(() => resolve(listResponse(path, options)));
          })
        : listResponse(path, options),
    );
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    const name = screen.getByRole("textbox", { name: "Name for Ada's solve" });
    await user.clear(name);
    await user.type(name, "Ada L");
    await user.click(
      screen.getByRole("combobox", { name: "Party for Ada's solve" }),
    );
    await user.click(await screen.findByRole("option", { name: /Babbages/ }));
    await user.click(screen.getByRole("button", { name: "Save Ada's solve" }));

    await waitFor(() => expect(pending).toHaveLength(2));
    pending.forEach((resolve) => resolve());
    expect(await screen.findByText("Ada L")).toBeInTheDocument();
  });

  it("retries only the write that failed", async () => {
    let failRename = true;
    mockEditableSession();
    const listResponse = adminRequest.getMockImplementation()!;
    adminRequest.mockImplementation((path: string, options?: object) =>
      path.endsWith("/rename") && failRename
        ? Promise.reject(new Error("Rename failed"))
        : listResponse(path, options),
    );
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    const name = screen.getByRole("textbox", { name: "Name for Ada's solve" });
    await user.clear(name);
    await user.type(name, "Ada L");
    await user.click(
      screen.getByRole("combobox", { name: "Party for Ada's solve" }),
    );
    await user.click(await screen.findByRole("option", { name: /Babbages/ }));
    await user.click(screen.getByRole("button", { name: "Save Ada's solve" }));

    // The party landed; the rename didn't, so the row is still editing.
    await waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: "Party for Ada's solve" }),
      ).toHaveTextContent("The Babbages"),
    );
    expect(
      screen.getByRole("textbox", { name: "Name for Ada's solve" }),
    ).toHaveValue("Ada L");

    failRename = false;
    adminRequest.mockClear();
    await user.click(screen.getByRole("button", { name: "Save Ada's solve" }));

    expect(await screen.findByText("Ada L")).toBeInTheDocument();
    expect(sessionWrites()).toEqual([
      [
        "/admin/games/sessions/s1/rename",
        { method: "POST", body: { display_name: "Ada L" } },
      ],
    ]);
  });

  it("keeps the pencil in the last action slot on every row", async () => {
    adminRequest.mockResolvedValue({
      items: [
        makeSession({
          id: "s1",
          completed_at: "2026-06-02T15:00:00Z",
          display_name: "Ada",
          on_leaderboard: true,
        }),
        makeSession({ id: "s2", completed_at: "2026-06-02T16:00:00Z" }),
      ],
      total: 2,
    });
    renderCrossword();

    for (const label of ["Edit Ada's solve", "Edit Anonymous's solve"]) {
      const pencil = await screen.findByRole("button", { name: label });
      const actions = pencil.closest("td")!.querySelectorAll("button");
      expect(actions[actions.length - 1]).toBe(pencil);
      expect(pencil.closest("div")).toHaveClass("justify-end");
    }
  });

  it("treats picking then clearing a party on an unaffiliated solve as no change", async () => {
    // The API sends a missing party as null, while the picker's clear yields
    // undefined; the two must compare equal.
    adminRequest.mockResolvedValue({
      items: [
        makeSession({
          id: "s1",
          completed_at: "2026-06-02T15:00:00Z",
          display_name: "Ada",
          on_leaderboard: true,
          party_id: null as unknown as undefined,
          party_name: null as unknown as undefined,
        }),
      ],
      total: 1,
    });
    const successSpy = vi.spyOn(toast, "success");
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    await user.click(
      screen.getByRole("combobox", { name: "Party for Ada's solve" }),
    );
    await user.click(await screen.findByRole("option", { name: /Babbages/ }));
    await user.click(
      screen.getByRole("button", { name: "Clear Party for Ada's solve" }),
    );
    await user.click(screen.getByRole("button", { name: "Save Ada's solve" }));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(sessionWrites()).toEqual([]);
    expect(successSpy).not.toHaveBeenCalled();
    successSpy.mockRestore();
  });

  it("does not save on the Enter that confirms an IME composition", async () => {
    mockEditableSession();
    const user = userEvent.setup();
    renderCrossword();

    await screen.findByText("Ada");
    await user.click(screen.getByRole("button", { name: "Edit Ada's solve" }));
    const name = screen.getByRole("textbox", { name: "Name for Ada's solve" });
    fireEvent.change(name, { target: { value: "エイダ" } });
    fireEvent.keyDown(name, { key: "Enter", isComposing: true });

    expect(name).toBeInTheDocument();
    expect(sessionWrites()).toEqual([]);
  });
});
