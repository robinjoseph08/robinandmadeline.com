import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Guest } from "@/types/generated/models";

import { GuestsGrid } from "./GuestsGrid";

const adminRequest = vi.fn();
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: (...args: unknown[]) => adminRequest(...args),
  };
});

function makeGuest(overrides: Partial<Guest>): Guest {
  return {
    id: "g1",
    party_id: "p7",
    full_name: "Guest",
    tags: [],
    is_primary: false,
    is_child: false,
    is_drinking: false,
    subscribed: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// Detail-page mode: the add row creates into addPartyId, so no party picker is
// involved and the row is driven entirely by its own draft.
function renderGrid(guests: Guest[], partyIdFor: (guest: Guest) => string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <GuestsGrid<Guest>
            addPartyId="p7"
            guests={guests}
            onEditGuest={() => {}}
            partyIdFor={partyIdFor}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
  adminRequest.mockResolvedValue(undefined);
});

describe("GuestsGrid add-row isolation", () => {
  it("does not re-render the existing guest rows while typing a new guest", async () => {
    // partyIdFor runs once per guest on every GuestsGrid render, so its call
    // count is a proxy for "the grid (and therefore every guest row) rendered".
    // The add row owns its own draft, so opening it and typing into it must not
    // touch the grid; otherwise a long list re-renders on every keystroke, which
    // is the lag this component was split out to fix.
    const partyIdFor = vi.fn((guest: Guest) => guest.party_id);
    const guests = Array.from({ length: 10 }, (_, i) =>
      makeGuest({ id: `g${i}`, full_name: `Guest ${i}` }),
    );

    const user = userEvent.setup();
    renderGrid(guests, partyIdFor);

    // Let the initial render settle, then watch only what happens afterward.
    await screen.findByRole("button", { name: "Add guest" });
    partyIdFor.mockClear();

    await user.click(screen.getByRole("button", { name: "Add guest" }));
    await user.type(
      screen.getByRole("textbox", { name: "New guest name" }),
      "Newbie",
    );

    // The typed value lands in the add row...
    expect(screen.getByRole("textbox", { name: "New guest name" })).toHaveValue(
      "Newbie",
    );
    // ...without ever re-rendering the grid body that holds the guest rows.
    expect(partyIdFor).not.toHaveBeenCalled();
  });
});

describe("GuestsGrid phone cell", () => {
  it("formats a phone number live as it is typed and commits the formatted value", async () => {
    adminRequest.mockResolvedValue(
      makeGuest({ id: "g1", full_name: "Alice", phone: "+19725551234" }),
    );
    const user = userEvent.setup();
    renderGrid(
      [makeGuest({ id: "g1", full_name: "Alice" })],
      (g) => g.party_id,
    );

    // The phone cell punctuates US numbers as they are typed, matching the
    // info-collection and guest-dialog inputs.
    const phone = await screen.findByRole("textbox", { name: "Phone" });
    await user.type(phone, "9725551234");
    expect(phone).toHaveValue("(972) 555-1234");

    // Blurring commits the formatted value; the backend re-normalizes to E.164.
    await user.tab();
    await waitFor(() =>
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/g1", {
        method: "PATCH",
        body: { phone: "(972) 555-1234" },
      }),
    );
  });

  it("shows an Unsubscribed marker only for opted-out guests", () => {
    renderGrid(
      [
        makeGuest({ id: "g1", full_name: "Alice", subscribed: true }),
        makeGuest({ id: "g2", full_name: "Bob", subscribed: false }),
      ],
      (g) => g.party_id,
    );

    // Only the unsubscribed guest is flagged; the subscribed norm shows nothing.
    expect(screen.getAllByText("Unsubscribed")).toHaveLength(1);
  });
});
