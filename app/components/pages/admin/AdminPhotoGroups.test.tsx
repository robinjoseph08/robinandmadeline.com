import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { EventResponse } from "@/types/generated/events";
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

function makeEvent(overrides: Partial<EventResponse>): EventResponse {
  return {
    id: "e1",
    name: "Ceremony",
    description: undefined,
    location: undefined,
    date: "2026-10-17",
    start_time: undefined,
    end_time: undefined,
    is_public: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    rsvp_breakdown: { pending: 0, attending: 0, not_attending: 0, total: 0 },
    ...overrides,
  };
}

function makeGroup(overrides: Partial<PhotoGroupResponse>): PhotoGroupResponse {
  return {
    id: "pg1",
    event_id: "e1",
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
 * Stubs adminRequest with the page's three reads (events, photo groups,
 * guests) and captures writes through the optional handler, which wins when
 * it returns a value.
 */
function stubRequests({
  events = [makeEvent({})],
  groups = [],
  guests = [],
  onWrite,
}: {
  events?: EventResponse[];
  groups?: PhotoGroupResponse[];
  guests?: GuestListItem[];
  onWrite?: (path: string, options?: { method?: string }) => unknown;
}) {
  adminRequest.mockImplementation((path: string, options?: object) => {
    const method = (options as { method?: string } | undefined)?.method;
    if (onWrite && method && method !== "GET") {
      return Promise.resolve(onWrite(path, options as { method?: string }));
    }
    if (path === "/admin/events") {
      return Promise.resolve({ items: events, total: events.length });
    }
    if (path === "/admin/photo-groups") {
      return Promise.resolve({ items: groups, total: groups.length });
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
  it("renders each event's groups in order with positions and members", async () => {
    stubRequests({
      events: [
        makeEvent({ id: "e1", name: "Ceremony", date: "2026-10-17" }),
        makeEvent({ id: "e2", name: "Reception", date: "2026-10-17" }),
      ],
      groups: [
        makeGroup({
          id: "pg1",
          event_id: "e1",
          name: "Bride's Family",
          guests: [makeMember({})],
        }),
        makeGroup({
          id: "pg2",
          event_id: "e1",
          name: "College Friends",
          sort_order: 2,
        }),
      ],
    });

    renderPage();

    const ceremony = await screen.findByRole("region", { name: "Ceremony" });
    expect(within(ceremony).getByText("Bride's Family")).toBeInTheDocument();
    expect(within(ceremony).getByText("College Friends")).toBeInTheDocument();
    // Positions in the shooting order.
    expect(within(ceremony).getByText("Group 1 of 2")).toBeInTheDocument();
    expect(within(ceremony).getByText("Group 2 of 2")).toBeInTheDocument();
    // Members with their party.
    expect(
      within(ceremony).getByText("Alice Smith (The Smiths)"),
    ).toBeInTheDocument();
    // The groupless event still renders, with its empty state.
    const reception = screen.getByRole("region", { name: "Reception" });
    expect(
      within(reception).getByText(/no photo groups yet/i),
    ).toBeInTheDocument();
  });
});

describe("AdminPhotoGroups create", () => {
  it("POSTs the new group's event and name", async () => {
    const onWrite = vi.fn().mockResolvedValue(makeGroup({ id: "pg-new" }));
    stubRequests({ onWrite });

    const user = userEvent.setup();
    renderPage();

    const section = await screen.findByRole("region", { name: "Ceremony" });
    await user.type(
      within(section).getByLabelText("New photo group name for Ceremony"),
      "Bride's Family",
    );
    await user.click(
      within(section).getByRole("button", { name: "Add group to Ceremony" }),
    );

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/photo-groups", {
        method: "POST",
        body: { event_id: "e1", name: "Bride's Family" },
      });
    });
  });
});

describe("AdminPhotoGroups rename", () => {
  it("PUTs the edited name", async () => {
    const onWrite = vi
      .fn()
      .mockResolvedValue(makeGroup({ name: "Bride's Immediate Family" }));
    stubRequests({ groups: [makeGroup({})], onWrite });

    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Bride's Family");
    await user.click(
      screen.getByRole("button", { name: "Rename Bride's Family" }),
    );
    const input = screen.getByLabelText("Photo group name");
    await user.clear(input);
    await user.type(input, "Bride's Immediate Family");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/photo-groups/pg1", {
        method: "PUT",
        body: { name: "Bride's Immediate Family" },
      });
    });
  });
});

describe("AdminPhotoGroups delete", () => {
  it("DELETEs the group after confirmation", async () => {
    const onWrite = vi.fn().mockResolvedValue(undefined);
    stubRequests({ groups: [makeGroup({})], onWrite });
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
        body: { event_id: "e1", photo_group_ids: ["pg2", "pg1"] },
      });
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
