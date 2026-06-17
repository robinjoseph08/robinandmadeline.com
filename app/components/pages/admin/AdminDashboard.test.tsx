import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Response as DashboardResponse } from "@/types/generated/dashboard";

import AdminDashboard from "./AdminDashboard";

// adminRequest is the single network seam; the tests drive the UI by stubbing
// its response to the dashboard fetch.
const adminRequest = vi.fn();
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: (...args: unknown[]) => adminRequest(...args),
  };
});

function makeDashboard(
  overrides: Partial<DashboardResponse> = {},
): DashboardResponse {
  return {
    total_parties: 2,
    total_guests: 3,
    guest_breakdown: {
      by_side: { robin: 2, madeline: 1 },
      by_relation: { family: 1, friend: 2 },
    },
    events: [],
    rsvp_summary: {
      attending: 1,
      not_attending: 1,
      pending: 1,
      responded: 2,
      total: 3,
      response_rate: 2 / 3,
    },
    info_collection: { complete: 1, incomplete: 1, total: 2, rate: 0.5 },
    emails: { sent: 0, delivered: 0, delivery_rate: 0 },
    rsvp_deadline: undefined,
    ...overrides,
  };
}

// stub routes adminRequest for the dashboard fetch.
function stub(options: { dashboard?: DashboardResponse }) {
  adminRequest.mockImplementation((path: string) => {
    if (path === "/admin/dashboard") {
      return Promise.resolve(options.dashboard ?? makeDashboard());
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

function renderDashboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminDashboard stats", () => {
  it("renders the headline stat cards", async () => {
    stub({ dashboard: makeDashboard() });
    renderDashboard();

    // Each card pairs a label with its value; scope to the card so the bare
    // numbers don't collide with the breakdown rows below.
    const guests = (await screen.findByText("Total guests")).closest("div");
    expect(within(guests as HTMLElement).getByText("3")).toBeInTheDocument();
    const parties = screen.getByText("Total parties").closest("div");
    expect(within(parties as HTMLElement).getByText("2")).toBeInTheDocument();
    const rate = screen.getByText("RSVP response rate").closest("div");
    expect(within(rate as HTMLElement).getByText("67%")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 responses")).toBeInTheDocument();
  });

  it("shows the guest breakdown by side and relation", async () => {
    stub({ dashboard: makeDashboard() });
    renderDashboard();

    await screen.findByText("Guest breakdown");
    expect(screen.getByText("Robin")).toBeInTheDocument();
    expect(screen.getByText("Madeline")).toBeInTheDocument();
    expect(screen.getByText("Family")).toBeInTheDocument();
    expect(screen.getByText("Friend")).toBeInTheDocument();
  });

  it("renders a per-event RSVP breakdown with a link to the event", async () => {
    stub({
      dashboard: makeDashboard({
        events: [
          {
            id: "ev1",
            name: "Ceremony",
            description: undefined,
            location: undefined,
            date: "2026-08-01",
            start_time: undefined,
            end_time: undefined,
            is_public: true,
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
            rsvp_breakdown: {
              attending: 1,
              not_attending: 1,
              pending: 1,
              total: 3,
            },
          },
        ],
      }),
    });
    renderDashboard();

    const link = await screen.findByRole("link", { name: "Ceremony" });
    expect(link).toHaveAttribute("href", "/admin/events/ev1");
    expect(screen.getByText(/1 attending/)).toBeInTheDocument();
    expect(screen.getByText(/of 3 invited/)).toBeInTheDocument();
  });

  it("shows the info-collection progress as a progressbar", async () => {
    stub({ dashboard: makeDashboard() });
    renderDashboard();

    const bar = await screen.findByRole("progressbar", {
      name: "Info collection progress",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByText("1 of 2 parties complete")).toBeInTheDocument();
  });

  it("renders the email delivery summary with sent, delivered, and rate", async () => {
    // Pin the populated branch: the empty default never renders these numbers,
    // so a swap of sent/delivered or a botched rate format would slip through.
    stub({
      dashboard: makeDashboard({
        emails: { sent: 8, delivered: 6, delivery_rate: 0.75 },
      }),
    });
    renderDashboard();

    const heading = await screen.findByRole("heading", { name: "Emails" });
    const section = within(heading.closest("section") as HTMLElement);
    expect(section.getByText("8")).toBeInTheDocument();
    expect(section.getByText("6")).toBeInTheDocument();
    expect(section.getByText(/75% delivery rate/)).toBeInTheDocument();
  });
});
