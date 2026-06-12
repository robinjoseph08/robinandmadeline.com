import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { GuestListItem } from "@/types/generated/parties";
import type {
  PhotoGroupGuest,
  PhotoGroupResponse,
} from "@/types/generated/photogroups";

import AdminPhotoGroups from "./AdminPhotoGroups";

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

function makeGroup(overrides: Partial<PhotoGroupResponse>): PhotoGroupResponse {
  return {
    id: "pg1",
    name: "Bride's Family",
    sort_order: 1,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    guests: [],
    ...overrides,
  };
}

function makeMember(overrides: Partial<PhotoGroupGuest>): PhotoGroupGuest {
  return {
    guest_id: "g1",
    guest_name: "Alice Smith",
    party_id: "p1",
    party_name: "The Smiths",
    ...overrides,
  };
}

function makeGuest(overrides: Partial<GuestListItem>): GuestListItem {
  return {
    id: "g1",
    party_id: "p1",
    full_name: "Alice Smith",
    email: undefined,
    phone: undefined,
    tags: [],
    is_primary: true,
    is_child: false,
    is_drinking: true,
    placeholder_text: undefined,
    dietary_restrictions: undefined,
    table_number: undefined,
    seat_number: undefined,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    party_name: "The Smiths",
    ...overrides,
  };
}

/**
 * Stubs adminRequest with the page's two reads (photo groups, guests) and
 * captures writes through the optional handler, which wins when it returns a
 * value. `groups` may be a function so a write can change what the next list
 * refetch returns (pinning the mutation's cache invalidation).
 */
function stubRequests({
  groups = [],
  guests = [],
  onWrite,
}: {
  groups?: PhotoGroupResponse[] | (() => PhotoGroupResponse[]);
  guests?: GuestListItem[];
  onWrite?: (path: string, options?: { method?: string }) => unknown;
}) {
  adminRequest.mockImplementation((path: string, options?: object) => {
    const method = (options as { method?: string } | undefined)?.method;
    if (onWrite && method && method !== "GET") {
      return Promise.resolve(onWrite(path, options as { method?: string }));
    }
    if (path === "/admin/photo-groups") {
      const items = typeof groups === "function" ? groups() : groups;
      return Promise.resolve({ items, total: items.length });
    }
    if (path === "/admin/guests") {
      return Promise.resolve({ items: guests, total: guests.length });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminPhotoGroups />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminPhotoGroups list", () => {
  it("renders one flat list in shooting order with positions and members", async () => {
    stubRequests({
      groups: [
        makeGroup({
          id: "pg1",
          name: "Bride's Family",
          guests: [makeMember({})],
        }),
        makeGroup({
          id: "pg2",
          name: "College Friends",
          sort_order: 2,
        }),
      ],
    });

    renderPage();

    // Rows render in shooting order, each position label tied to its row's
    // group (not just present somewhere on the page).
    await screen.findByText("Bride's Family");
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Bride's Family");
    expect(rows[0]).toHaveTextContent("Group 1 of 2");
    expect(rows[1]).toHaveTextContent("College Friends");
    expect(rows[1]).toHaveTextContent("Group 2 of 2");
    // Members with their party, inside their group's row.
    expect(
      within(rows[0]).getByText("Alice Smith (The Smiths)"),
    ).toBeInTheDocument();
  });

  it("shows the empty state when there are no groups", async () => {
    stubRequests({ groups: [] });

    renderPage();

    expect(await screen.findByText(/no photo groups yet/i)).toBeInTheDocument();
  });
});

describe("AdminPhotoGroups create", () => {
  it("POSTs the new group's name", async () => {
    const onWrite = vi.fn().mockResolvedValue(makeGroup({ id: "pg-new" }));
    stubRequests({ onWrite });

    const user = userEvent.setup();
    renderPage();

    await user.type(
      await screen.findByLabelText("New photo group name"),
      "Bride's Family",
    );
    await user.click(screen.getByRole("button", { name: "Add group" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/photo-groups", {
        method: "POST",
        body: { name: "Bride's Family" },
      });
    });
  });
});

describe("AdminPhotoGroups rename", () => {
  it("PUTs the edited name and shows the renamed group after the refetch", async () => {
    let current = [makeGroup({})];
    const onWrite = vi.fn().mockImplementation(() => {
      current = [makeGroup({ name: "Bride's Immediate Family" })];
      return makeGroup({ name: "Bride's Immediate Family" });
    });
    stubRequests({ groups: () => current, onWrite });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Bride's Family");
    await user.click(
      screen.getByRole("button", { name: "Rename Bride's Family" }),
    );
    const input = screen.getByLabelText("Photo group name for Bride's Family");
    await user.clear(input);
    await user.type(input, "Bride's Immediate Family");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/photo-groups/pg1", {
        method: "PUT",
        body: { name: "Bride's Immediate Family" },
      });
    });
    // The mutation invalidates the list, so the refetched name renders.
    expect(
      await screen.findByText("Bride's Immediate Family"),
    ).toBeInTheDocument();
  });
});

describe("AdminPhotoGroups delete", () => {
  it("DELETEs the group after confirmation and drops it after the refetch", async () => {
    let current = [makeGroup({})];
    const onWrite = vi.fn().mockImplementation(() => {
      current = [];
      return undefined;
    });
    stubRequests({ groups: () => current, onWrite });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Bride's Family");
    await user.click(
      screen.getByRole("button", { name: "Delete Bride's Family" }),
    );

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/photo-groups/pg1", {
        method: "DELETE",
      });
    });
    // The mutation invalidates the list, so the empty state replaces the row.
    expect(await screen.findByText(/no photo groups yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Bride's Family")).not.toBeInTheDocument();
  });
});

describe("AdminPhotoGroups reorder", () => {
  it("POSTs the full id sequence with the moved group swapped up", async () => {
    const onWrite = vi.fn().mockResolvedValue({ items: [], total: 0 });
    stubRequests({
      groups: [
        makeGroup({ id: "pg1", name: "Bride's Family" }),
        makeGroup({ id: "pg2", name: "College Friends", sort_order: 2 }),
      ],
      onWrite,
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("College Friends");
    await user.click(
      screen.getByRole("button", { name: "Move College Friends up" }),
    );

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/photo-groups/reorder", {
        method: "POST",
        body: { photo_group_ids: ["pg2", "pg1"] },
      });
    });
  });

  it("POSTs the full id sequence with the moved group swapped down", async () => {
    const onWrite = vi.fn().mockResolvedValue({ items: [], total: 0 });
    stubRequests({
      groups: [
        makeGroup({ id: "pg1", name: "Bride's Family" }),
        makeGroup({ id: "pg2", name: "College Friends", sort_order: 2 }),
      ],
      onWrite,
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("College Friends");
    await user.click(
      screen.getByRole("button", { name: "Move Bride's Family down" }),
    );

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/photo-groups/reorder", {
        method: "POST",
        body: { photo_group_ids: ["pg2", "pg1"] },
      });
    });
  });

  it("keeps the move buttons disabled until the refetched order lands", async () => {
    // The reorder mutation deliberately stays pending through the list
    // refetch (its onSettled returns the invalidation promise), because the
    // next move's payload is computed from the rendered order. Hold the
    // refetch open and check the buttons only re-enable once it resolves.
    let releaseRefetch:
      | ((value: { items: PhotoGroupResponse[]; total: number }) => void)
      | undefined;
    const groups = [
      makeGroup({ id: "pg1", name: "Bride's Family" }),
      makeGroup({ id: "pg2", name: "College Friends", sort_order: 2 }),
    ];
    let listCalls = 0;
    adminRequest.mockImplementation((path: string, options?: object) => {
      const method = (options as { method?: string } | undefined)?.method;
      if (path === "/admin/photo-groups/reorder" && method === "POST") {
        return Promise.resolve({ items: [], total: 0 });
      }
      if (path === "/admin/photo-groups") {
        listCalls += 1;
        if (listCalls === 1) {
          return Promise.resolve({ items: groups, total: groups.length });
        }
        return new Promise((resolve) => {
          releaseRefetch = resolve;
        });
      }
      return Promise.resolve({ items: [], total: 0 });
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("College Friends");
    const moveUp = screen.getByRole("button", {
      name: "Move College Friends up",
    });
    await user.click(moveUp);

    // The POST has resolved but the refetch is still in flight: every move
    // button must stay disabled so a second move cannot use the stale order.
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/photo-groups/reorder",
        expect.anything(),
      );
    });
    expect(moveUp).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Bride's Family down" }),
    ).toBeDisabled();

    releaseRefetch?.({ items: [...groups].reverse(), total: groups.length });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Move College Friends down" }),
      ).toBeEnabled();
    });
  });

  it("disables moving the first group up and the last down", async () => {
    stubRequests({
      groups: [
        makeGroup({ id: "pg1", name: "Bride's Family" }),
        makeGroup({ id: "pg2", name: "College Friends", sort_order: 2 }),
      ],
    });

    renderPage();

    await screen.findByText("College Friends");
    expect(
      screen.getByRole("button", { name: "Move Bride's Family up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move College Friends down" }),
    ).toBeDisabled();
  });
});

describe("AdminPhotoGroups members", () => {
  it("POSTs the picked guest to the group", async () => {
    const onWrite = vi.fn().mockResolvedValue(makeGroup({}));
    stubRequests({
      groups: [makeGroup({})],
      guests: [makeGuest({})],
      onWrite,
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Bride's Family");
    await user.click(
      screen.getByRole("combobox", { name: "Add guest to Bride's Family" }),
    );
    await user.click(
      await screen.findByRole("option", { name: /Alice Smith/ }),
    );

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/photo-groups/pg1/guests",
        { method: "POST", body: { guest_id: "g1" } },
      );
    });
  });

  it("hides guests who are already members from the picker", async () => {
    stubRequests({
      groups: [makeGroup({ guests: [makeMember({})] })],
      guests: [
        makeGuest({}),
        makeGuest({ id: "g2", full_name: "Bob Smith", is_primary: false }),
      ],
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Bride's Family");
    await user.click(
      screen.getByRole("combobox", { name: "Add guest to Bride's Family" }),
    );

    expect(
      await screen.findByRole("option", { name: /Bob Smith/ }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: /Alice Smith/ }),
    ).not.toBeInTheDocument();
  });

  it("DELETEs a removed member", async () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    stubRequests({
      groups: [makeGroup({ guests: [makeMember({})] })],
      onWrite,
    });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Alice Smith (The Smiths)");
    await user.click(
      screen.getByRole("button", {
        name: "Remove Alice Smith from Bride's Family",
      }),
    );

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/photo-groups/pg1/guests/g1",
        { method: "DELETE" },
      );
    });
  });
});
