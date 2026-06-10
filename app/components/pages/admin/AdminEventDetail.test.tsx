import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  EventResponse,
  EventRSVPListItem,
} from "@/types/generated/events";

import AdminEventDetail from "./AdminEventDetail";

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
    name: "Rehearsal Dinner",
    description: undefined,
    location: undefined,
    date: "2026-10-16",
    start_time: undefined,
    end_time: undefined,
    is_public: false,
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    rsvp_breakdown: { pending: 0, attending: 0, not_attending: 0, total: 0 },
    ...overrides,
  };
}

function makeRSVP(overrides: Partial<EventRSVPListItem>): EventRSVPListItem {
  return {
    id: "r1",
    event_id: "e1",
    guest_id: "g1",
    status: "pending",
    rsvped_at: undefined,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    guest_name: "Alice",
    party_id: "p1",
    party_name: "The Smiths",
    ...overrides,
  };
}

function makeParty(id: string, name: string) {
  return {
    id,
    name,
    side: "robin",
    relation: "family",
    circle: [],
    invitation_type: "digital",
    info_token: "tok",
    info_collection_requested: false,
    info_collection_confirmed: false,
    info_collection_status: "incomplete",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    guests: [],
  };
}

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/events/e1"]}>
          <Routes>
            <Route element={<AdminEventDetail />} path="/admin/events/:id" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminEventDetail invite parties", () => {
  it("invites the checked parties to a private event", async () => {
    adminRequest.mockImplementation((path: string, options?: object) => {
      const method = (options as { method?: string } | undefined)?.method;
      if (path === "/admin/events/e1/invite" && method === "POST") {
        return Promise.resolve(makeEvent({}));
      }
      if (path === "/admin/events/e1") {
        return Promise.resolve(makeEvent({}));
      }
      if (path === "/admin/events/e1/rsvps") {
        return Promise.resolve({ items: [], total: 0 });
      }
      if (path === "/admin/parties") {
        return Promise.resolve({
          items: [
            makeParty("p1", "The Smiths"),
            makeParty("p2", "The Joneses"),
          ],
          total: 2,
        });
      }
      return Promise.resolve(undefined);
    });

    const user = userEvent.setup();
    renderDetail();

    // A private event offers the invite section listing every party.
    expect(await screen.findByText("Invite parties")).toBeInTheDocument();
    await user.click(
      await screen.findByRole("checkbox", { name: /The Joneses/ }),
    );
    await user.click(screen.getByRole("button", { name: "Invite selected" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/events/e1/invite", {
        method: "POST",
        body: { party_ids: ["p2"] },
      });
    });
  });

  it("offers no invite section for a public event", async () => {
    adminRequest.mockImplementation((path: string) => {
      if (path === "/admin/events/e1") {
        return Promise.resolve(makeEvent({ is_public: true }));
      }
      if (path === "/admin/events/e1/rsvps") {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.resolve({ items: [], total: 0 });
    });

    renderDetail();

    expect(
      await screen.findByText(/every guest is invited automatically/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Invite parties")).not.toBeInTheDocument();
  });
});

describe("AdminEventDetail RSVP override", () => {
  it("PUTs the new status for one guest's RSVP", async () => {
    adminRequest.mockImplementation((path: string, options?: object) => {
      const method = (options as { method?: string } | undefined)?.method;
      if (path === "/admin/events/e1/rsvps/g1" && method === "PUT") {
        return Promise.resolve(makeRSVP({ status: "attending" }));
      }
      if (path === "/admin/events/e1") {
        return Promise.resolve(
          makeEvent({
            rsvp_breakdown: {
              pending: 1,
              attending: 0,
              not_attending: 0,
              total: 1,
            },
          }),
        );
      }
      if (path === "/admin/events/e1/rsvps") {
        return Promise.resolve({ items: [makeRSVP({})], total: 1 });
      }
      return Promise.resolve({ items: [], total: 0 });
    });

    const user = userEvent.setup();
    renderDetail();

    // The RSVP row shows the guest with its party and a status control.
    const row = (await screen.findByText("Alice")).closest("tr")!;
    expect(within(row).getByText("The Smiths")).toBeInTheDocument();

    await user.click(
      within(row).getByRole("combobox", { name: "RSVP status for Alice" }),
    );
    await user.click(await screen.findByRole("option", { name: "Attending" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/events/e1/rsvps/g1", {
        method: "PUT",
        body: { status: "attending" },
      });
    });
  });
});
