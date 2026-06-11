import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RSVPConfirmation from "@/components/pages/RSVPConfirmation";
import { GUEST_TOKEN_STORAGE_KEY } from "@/libraries/guest-api";
import type { PartyRSVPsResponse } from "@/types/generated/rsvps";

const guestRequest = vi.fn();
vi.mock("@/libraries/guest-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/guest-api");
  return {
    ...actual,
    guestRequest: (...args: unknown[]) => guestRequest(...args),
  };
});

function makeData(): PartyRSVPsResponse {
  return {
    party_name: "The Smiths",
    guests: [
      {
        id: "g1",
        full_name: "Alice Smith",
        is_placeholder: false,
        dietary_restrictions: undefined,
      },
      {
        id: "g2",
        full_name: "Dana Lee",
        is_placeholder: true,
        dietary_restrictions: "no nuts",
      },
    ],
    events: [
      {
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
        rsvps: [
          { guest_id: "g1", status: "attending" },
          { guest_id: "g2", status: "not_attending" },
        ],
      },
    ],
    closed: false,
    rsvp_deadline: undefined,
    contact_email: undefined,
  };
}

function renderConfirmation() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/rsvp/confirmation"]}>
        <Routes>
          <Route element={<RSVPConfirmation />} path="/rsvp/confirmation" />
          <Route element={<div>Code Entry Page</div>} path="/rsvp" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RSVPConfirmation", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "a.guest.jwt");
    guestRequest.mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("redirects to code entry when there is no stored token", async () => {
    localStorage.clear();
    renderConfirmation();
    expect(await screen.findByText("Code Entry Page")).toBeInTheDocument();
  });

  it("summarizes who is attending what, with schedule and edit links", async () => {
    guestRequest.mockResolvedValue(makeData());
    renderConfirmation();

    const ceremony = await screen.findByRole("region", { name: "Ceremony" });
    expect(within(ceremony).getByText("Alice Smith")).toBeInTheDocument();
    expect(within(ceremony).getByText("Dana Lee")).toBeInTheDocument();
    expect(within(ceremony).getByText("Attending:")).toBeInTheDocument();
    expect(within(ceremony).getByText("Not attending:")).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /view the schedule/i }),
    ).toHaveAttribute("href", "/schedule");
    // Guests can return and adjust their answers until the deadline.
    expect(
      screen.getByRole("link", { name: /edit your rsvp/i }),
    ).toHaveAttribute("href", "/rsvp/form");
  });
});
