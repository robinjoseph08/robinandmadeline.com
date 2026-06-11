import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RSVPConfirmation from "@/components/pages/RSVPConfirmation";
import { QueryKey } from "@/hooks/queries/rsvp";
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

function makeData(
  overrides: Partial<PartyRSVPsResponse> = {},
): PartyRSVPsResponse {
  return {
    guests: [
      {
        id: "g1",
        full_name: "Alice Smith",
        placeholder_text: undefined,
        dietary_restrictions: undefined,
      },
      {
        // A named placeholder: the descriptor persists alongside the name.
        id: "g2",
        full_name: "Dana Lee",
        placeholder_text: "Guest of Alice",
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
      {
        id: "e2",
        name: "Reception",
        description: undefined,
        location: undefined,
        date: "2026-10-17",
        start_time: undefined,
        end_time: undefined,
        is_public: true,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        rsvps: [{ guest_id: "g1", status: "pending" }],
      },
    ],
    responded: true,
    closed: false,
    rsvp_deadline: undefined,
    contact_email: undefined,
    ...overrides,
  };
}

function renderConfirmation() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/rsvp/confirmation"]}>
        <Routes>
          <Route element={<RSVPConfirmation />} path="/rsvp/confirmation" />
          <Route element={<div>Code Entry Page</div>} path="/rsvp" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
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

  it("summarizes each guest's responses and dietary restrictions", async () => {
    guestRequest.mockResolvedValue(makeData());
    renderConfirmation();

    // One card per guest, mirroring the form: their status for every event
    // they are invited to, then what they told us about dietary restrictions.
    const alice = await screen.findByRole("region", { name: "Alice Smith" });
    expect(within(alice).getByText("Ceremony")).toBeInTheDocument();
    expect(
      within(alice).getByText("Attending", { exact: true }),
    ).toBeInTheDocument();
    expect(within(alice).getByText("Reception")).toBeInTheDocument();
    expect(within(alice).getByText("No response")).toBeInTheDocument();
    expect(within(alice).getByText("None")).toBeInTheDocument();

    // Dana is only invited to the ceremony, so her card never lists the
    // reception.
    const dana = screen.getByRole("region", { name: "Dana Lee" });
    expect(within(dana).getByText("Ceremony")).toBeInTheDocument();
    expect(within(dana).getByText("Not attending")).toBeInTheDocument();
    expect(within(dana).queryByText("Reception")).not.toBeInTheDocument();
    expect(within(dana).getByText("no nuts")).toBeInTheDocument();

    // The copy never exposes the party's internal admin label.
    expect(
      screen.getByText(/here is what we have for your party/i),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /view the schedule/i }),
    ).toHaveAttribute("href", "/schedule");
    // Guests can return and adjust their answers until the deadline.
    expect(
      screen.getByRole("link", { name: /edit your rsvp/i }),
    ).toHaveAttribute("href", "/rsvp/form");
  });

  it("includes the deadline date in the change-your-responses note", async () => {
    guestRequest.mockResolvedValue(
      makeData({ rsvp_deadline: "2026-08-01T12:00:00Z" }),
    );
    renderConfirmation();

    expect(
      await screen.findByText(/any time before August 1, 2026\./),
    ).toBeInTheDocument();
  });

  it("falls back to a generic note when no deadline is configured", async () => {
    guestRequest.mockResolvedValue(makeData());
    renderConfirmation();

    expect(
      await screen.findByText(/any time before the deadline\./),
    ).toBeInTheDocument();
  });

  it("explains how to reach the couple once the deadline has passed", async () => {
    guestRequest.mockResolvedValue(
      makeData({ closed: true, contact_email: "couple@example.com" }),
    );
    renderConfirmation();

    expect(
      await screen.findByText(/the rsvp deadline has passed/i),
    ).toBeInTheDocument();
    const mailto = screen.getByRole("link", { name: "couple@example.com" });
    expect(mailto).toHaveAttribute("href", "mailto:couple@example.com");

    // Responses can no longer be changed online, so there is no way back to
    // the form.
    expect(
      screen.queryByRole("link", { name: /edit your rsvp/i }),
    ).not.toBeInTheDocument();
  });

  it("falls back to generic contact copy when no email is configured", async () => {
    guestRequest.mockResolvedValue(makeData({ closed: true }));
    renderConfirmation();

    expect(
      await screen.findByText(/reach out to us directly/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /@/ })).not.toBeInTheDocument();
  });

  it("clears the token and returns to code entry via Not your party?", async () => {
    // The escape hatch for a visitor whose stored token landed them on someone
    // else's party: forget the token and go back to code entry.
    guestRequest.mockResolvedValue(makeData());
    const user = userEvent.setup();
    const queryClient = renderConfirmation();

    await user.click(
      await screen.findByRole("button", { name: /not your party\?/i }),
    );

    expect(await screen.findByText("Code Entry Page")).toBeInTheDocument();
    expect(localStorage.getItem(GUEST_TOKEN_STORAGE_KEY)).toBeNull();
    // The abandoned party's cached RSVP data goes with the token; otherwise a
    // different code logging in next would briefly see (and the form would
    // seed from) the wrong party's answers.
    expect(queryClient.getQueryData([QueryKey.PartyRSVPs])).toBeUndefined();
  });
});
