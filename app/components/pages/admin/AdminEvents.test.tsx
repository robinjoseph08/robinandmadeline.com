import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { EventResponse } from "@/types/generated/events";

import AdminEvents from "./AdminEvents";

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
    name: "Reception",
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

function renderEvents() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminEvents />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminEvents list", () => {
  it("renders each event with its RSVP breakdown", async () => {
    adminRequest.mockResolvedValue({
      items: [
        makeEvent({
          id: "e-reception",
          name: "Reception",
          rsvp_breakdown: {
            pending: 5,
            attending: 3,
            not_attending: 1,
            total: 9,
          },
        }),
        makeEvent({
          id: "e-rehearsal",
          name: "Rehearsal Dinner",
          is_public: false,
        }),
      ],
      total: 2,
    });

    renderEvents();

    expect(await screen.findByText("Reception")).toBeInTheDocument();
    expect(screen.getByText("Rehearsal Dinner")).toBeInTheDocument();
    // The breakdown reads attending / declined / pending of total invited.
    expect(screen.getByText("3 attending")).toBeInTheDocument();
    expect(screen.getByText("1 declined")).toBeInTheDocument();
    expect(screen.getByText("5 pending")).toBeInTheDocument();
    expect(screen.getByText(/of 9 invited/)).toBeInTheDocument();
    // The private event with no rows reads as uninvited.
    expect(screen.getByText("No guests invited")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("Private")).toBeInTheDocument();
  });

  it("renders the location as a link when the event has a Location Link", async () => {
    adminRequest.mockResolvedValue({
      items: [
        makeEvent({
          id: "e-reception",
          name: "Reception",
          location: "The Grand Hall",
          location_url: "https://maps.app.goo.gl/abc123",
        }),
      ],
      total: 1,
    });

    renderEvents();

    const link = await screen.findByRole("link", { name: "The Grand Hall" });
    expect(link).toHaveAttribute("href", "https://maps.app.goo.gl/abc123");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("AdminEvents create", () => {
  it("POSTs the dialog's payload and refreshes the list", async () => {
    adminRequest.mockImplementation((path: string, options?: object) => {
      if (
        path === "/admin/events" &&
        (options as { method?: string } | undefined)?.method === "POST"
      ) {
        return Promise.resolve(makeEvent({ id: "e-new", name: "Brunch" }));
      }
      return Promise.resolve({ items: [], total: 0 });
    });

    const user = userEvent.setup();
    renderEvents();

    await user.click(await screen.findByRole("button", { name: /Add event/ }));
    await user.type(screen.getByLabelText("Name"), "Brunch");
    // jsdom supports typing into a date input via its value format.
    await user.type(screen.getByLabelText("Date"), "2026-10-18");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/events", {
        method: "POST",
        body: {
          name: "Brunch",
          description: undefined,
          location: undefined,
          location_url: undefined,
          date: "2026-10-18",
          start_time: undefined,
          end_time: undefined,
          is_public: false,
        },
      });
    });
  });

  it("sends the location and its link when both are filled in", async () => {
    adminRequest.mockImplementation((path: string, options?: object) => {
      if (
        path === "/admin/events" &&
        (options as { method?: string } | undefined)?.method === "POST"
      ) {
        return Promise.resolve(makeEvent({ id: "e-new", name: "Reception" }));
      }
      return Promise.resolve({ items: [], total: 0 });
    });

    const user = userEvent.setup();
    renderEvents();

    await user.click(await screen.findByRole("button", { name: /Add event/ }));
    await user.type(screen.getByLabelText("Name"), "Reception");
    await user.type(screen.getByLabelText("Location"), "The Grand Hall");
    await user.type(
      screen.getByLabelText("Location link"),
      "https://maps.app.goo.gl/abc123",
    );
    await user.type(screen.getByLabelText("Date"), "2026-10-18");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/events", {
        method: "POST",
        body: {
          name: "Reception",
          description: undefined,
          location: "The Grand Hall",
          location_url: "https://maps.app.goo.gl/abc123",
          date: "2026-10-18",
          start_time: undefined,
          end_time: undefined,
          is_public: false,
        },
      });
    });
  });
});

describe("AdminEvents delete", () => {
  it("DELETEs the event after confirmation", async () => {
    adminRequest.mockImplementation((path: string, options?: object) => {
      if (
        path === "/admin/events/e1" &&
        (options as { method?: string } | undefined)?.method === "DELETE"
      ) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        items: [makeEvent({ id: "e1", name: "Reception" })],
        total: 1,
      });
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    renderEvents();

    await screen.findByText("Reception");
    await user.click(screen.getByRole("button", { name: "Delete Reception" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/events/e1", {
        method: "DELETE",
      });
    });
  });
});
