import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RSVPForm from "@/components/pages/RSVPForm";
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
        full_name: "Guest of Alice",
        is_placeholder: true,
        dietary_restrictions: undefined,
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
          { guest_id: "g1", status: "pending" },
          { guest_id: "g2", status: "pending" },
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
        rsvps: [
          { guest_id: "g1", status: "pending" },
          { guest_id: "g2", status: "pending" },
        ],
      },
    ],
    closed: false,
    rsvp_deadline: undefined,
    contact_email: undefined,
    ...overrides,
  };
}

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/rsvp/form"]}>
        <Routes>
          <Route element={<RSVPForm />} path="/rsvp/form" />
          <Route element={<div>Code Entry Page</div>} path="/rsvp" />
          <Route
            element={<div>Confirmation Page</div>}
            path="/rsvp/confirmation"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("RSVPForm", () => {
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
    renderForm();
    expect(await screen.findByText("Code Entry Page")).toBeInTheDocument();
    expect(guestRequest).not.toHaveBeenCalled();
  });

  it("renders every guest with their invited events, toggles, and fields", async () => {
    guestRequest.mockResolvedValue(makeData());
    renderForm();

    const alice = await screen.findByRole("region", { name: "Alice Smith" });
    const plusOne = screen.getByRole("region", { name: "Guest of Alice" });

    // Each guest section lists both events with attending / not attending
    // toggles.
    for (const section of [alice, plusOne]) {
      expect(
        within(section).getByRole("button", { name: "Ceremony: attending" }),
      ).toBeInTheDocument();
      expect(
        within(section).getByRole("button", {
          name: "Ceremony: not attending",
        }),
      ).toBeInTheDocument();
      expect(
        within(section).getByRole("button", { name: "Reception: attending" }),
      ).toBeInTheDocument();
      expect(
        within(section).getByLabelText("Dietary restrictions"),
      ).toBeInTheDocument();
    }

    // Only the placeholder guest gets an editable name field.
    expect(within(plusOne).getByLabelText("Name")).toBeInTheDocument();
    expect(within(alice).queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("submits the whole form and navigates to the confirmation", async () => {
    const data = makeData();
    guestRequest.mockImplementation(
      (_path: string, options?: { method?: string }) => {
        if (options?.method === "PUT") return Promise.resolve(makeData());
        return Promise.resolve(data);
      },
    );

    const user = userEvent.setup();
    renderForm();

    const alice = await screen.findByRole("region", { name: "Alice Smith" });
    const plusOne = screen.getByRole("region", { name: "Guest of Alice" });

    // Alice attends the ceremony but not the reception; the plus-one gets a
    // real name, attends the ceremony, and notes an allergy.
    await user.click(
      within(alice).getByRole("button", { name: "Ceremony: attending" }),
    );
    await user.click(
      within(alice).getByRole("button", { name: "Reception: not attending" }),
    );
    await user.type(within(plusOne).getByLabelText("Name"), "Dana Lee");
    await user.click(
      within(plusOne).getByRole("button", { name: "Ceremony: attending" }),
    );
    await user.type(
      within(plusOne).getByLabelText("Dietary restrictions"),
      "no nuts",
    );

    await user.click(screen.getByRole("button", { name: /submit rsvp/i }));

    await waitFor(() => {
      expect(guestRequest).toHaveBeenCalledWith(
        "/guest/rsvp",
        expect.objectContaining({
          method: "PUT",
          body: {
            guests: [
              {
                guest_id: "g1",
                full_name: undefined,
                dietary_restrictions: undefined,
                rsvps: [
                  { event_id: "e1", status: "attending" },
                  { event_id: "e2", status: "not_attending" },
                ],
              },
              {
                guest_id: "g2",
                full_name: "Dana Lee",
                dietary_restrictions: "no nuts",
                rsvps: [
                  { event_id: "e1", status: "attending" },
                  { event_id: "e2", status: "pending" },
                ],
              },
            ],
          },
        }),
      );
    });

    expect(await screen.findByText("Confirmation Page")).toBeInTheDocument();
  });

  it("renders read-only with a contact message after the deadline", async () => {
    guestRequest.mockResolvedValue(
      makeData({
        closed: true,
        contact_email: "couple@example.com",
        events: [
          {
            ...makeData().events[0],
            rsvps: [
              { guest_id: "g1", status: "attending" },
              { guest_id: "g2", status: "not_attending" },
            ],
          },
        ],
      }),
    );
    renderForm();

    // The current responses show read-only.
    const ceremony = await screen.findByRole("region", { name: "Ceremony" });
    expect(within(ceremony).getByText("Alice Smith")).toBeInTheDocument();
    expect(within(ceremony).getByText("Attending")).toBeInTheDocument();
    expect(within(ceremony).getByText("Not attending")).toBeInTheDocument();

    // No editable controls remain.
    expect(
      screen.queryByRole("button", { name: /submit rsvp/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Ceremony: attending" }),
    ).not.toBeInTheDocument();

    // The contact-us message links to the configured contact email.
    const mailto = screen.getByRole("link", { name: "couple@example.com" });
    expect(mailto).toHaveAttribute("href", "mailto:couple@example.com");
  });

  it("clears the token and redirects when the API rejects it", async () => {
    guestRequest.mockRejectedValue(
      Object.assign(new Error("Invalid or expired token."), {
        name: "ApiError",
        status: 401,
      }),
    );
    renderForm();

    expect(await screen.findByText("Code Entry Page")).toBeInTheDocument();
    expect(localStorage.getItem(GUEST_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
