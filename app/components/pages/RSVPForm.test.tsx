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
    guests: [
      {
        id: "g1",
        full_name: "Alice Smith",
        placeholder_text: undefined,
        dietary_restrictions: undefined,
      },
      {
        // An unnamed placeholder: full_name still equals the descriptor.
        id: "g2",
        full_name: "Guest of Alice",
        placeholder_text: "Guest of Alice",
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
    responded: false,
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

    // The header never exposes the party's internal admin label.
    expect(
      screen.getByText(/please respond for each member of your party/i),
    ).toBeInTheDocument();

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

    // Only the placeholder guest gets an editable name field. An unnamed slot
    // (full_name still equals the descriptor) starts blank: the heading
    // already shows "Guest of Alice", which is not a name to erase.
    expect(within(plusOne).getByLabelText("Name")).toHaveValue("");
    expect(within(alice).queryByLabelText("Name")).not.toBeInTheDocument();
  });

  it("prefills a named placeholder's name field with the submitted name", async () => {
    // A return visit after the placeholder was named: full_name no longer
    // equals the descriptor, so the input shows the name on file (editable
    // for corrections and swaps) instead of looking forgotten.
    const data = makeData();
    data.guests[1].full_name = "Dana Lee";
    guestRequest.mockResolvedValue(data);
    renderForm();

    const plusOne = await screen.findByRole("region", { name: "Dana Lee" });
    expect(within(plusOne).getByLabelText("Name")).toHaveValue("Dana Lee");
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

  it("shows each event's date and time when times are set", async () => {
    const data = makeData();
    data.events[0].start_time = "17:00";
    data.events[1].start_time = "17:30";
    data.events[1].end_time = "22:00";
    guestRequest.mockResolvedValue(data);
    renderForm();

    const alice = await screen.findByRole("region", { name: "Alice Smith" });

    // A start time alone renders next to the date; a start and end render as
    // a range. The 24-hour stored values display in 12-hour time.
    expect(
      within(alice).getByText("Saturday, October 17, 2026 · 5:00 PM"),
    ).toBeInTheDocument();
    expect(
      within(alice).getByText(
        "Saturday, October 17, 2026 · 5:30 PM to 10:00 PM",
      ),
    ).toBeInTheDocument();
  });

  it("shows only the date when an event has no start time", async () => {
    guestRequest.mockResolvedValue(makeData());
    renderForm();

    const alice = await screen.findByRole("region", { name: "Alice Smith" });
    expect(
      within(alice).getAllByText("Saturday, October 17, 2026"),
    ).toHaveLength(2);
  });

  it("redirects to the confirmation after the deadline", async () => {
    guestRequest.mockResolvedValue(makeData({ closed: true }));
    renderForm();

    // After the deadline there is no form (read-only or otherwise): the
    // confirmation page owns the post-deadline summary and messaging.
    expect(await screen.findByText("Confirmation Page")).toBeInTheDocument();
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
