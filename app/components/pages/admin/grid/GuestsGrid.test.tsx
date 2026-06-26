import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Guest } from "@/types/generated/models";
import type { PartyResponse } from "@/types/generated/parties";

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

function makeParty(overrides: Partial<PartyResponse>): PartyResponse {
  return {
    id: "p7",
    name: "The Smiths",
    side: "robin",
    relation: "family",
    circle: [],
    invitation_type: "digital",
    info_token: "tok",
    info_collection_requested: false,
    info_collection_confirmed: false,
    info_collection_status: "incomplete",
    missing_required_fields: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    guests: [],
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

// Flat-list mode: passing parties turns on the editable Party picker and the
// read-only party-attribute columns resolved from each guest's party.
function renderFlatGrid(guests: Guest[], parties: PartyResponse[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <GuestsGrid<Guest>
            guests={guests}
            onEditGuest={() => {}}
            parties={parties}
            partyIdFor={(guest) => guest.party_id}
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
});

describe("GuestsGrid guest columns", () => {
  it("reflects the subscribed flag and toggles it inline via PATCH", async () => {
    adminRequest.mockResolvedValue(makeGuest({ id: "g1", subscribed: false }));
    const user = userEvent.setup();
    renderGrid(
      [makeGuest({ id: "g1", full_name: "Alice", subscribed: true })],
      (g) => g.party_id,
    );

    // The subscription opt-in (ADR 0009) is now an editable checkbox, not a
    // read-only marker: it mirrors the stored flag and unchecking it PATCHes.
    const subscribed = screen.getByRole("checkbox", { name: "Subscribed" });
    expect(subscribed).toBeChecked();
    await user.click(subscribed);
    await waitFor(() =>
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/g1", {
        method: "PATCH",
        body: { subscribed: false },
      }),
    );
  });

  it("sends a seating number as a string so a blank can clear it", async () => {
    adminRequest.mockResolvedValue(makeGuest({ id: "g1", table_number: 9 }));
    const user = userEvent.setup();
    renderGrid(
      [makeGuest({ id: "g1", full_name: "Alice", table_number: 4 })],
      (g) => g.party_id,
    );

    // The table-number cell is a number input; it commits the value as a string
    // (the clearable PATCH convention), so a later blank can mean "un-assign".
    const table = screen.getByRole("spinbutton", { name: "Table number" });
    expect(table).toHaveValue(4);
    await user.clear(table);
    await user.type(table, "9");
    await user.tab();
    await waitFor(() =>
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/g1", {
        method: "PATCH",
        body: { table_number: "9" },
      }),
    );
  });

  it("patches the seat number under its own key", async () => {
    adminRequest.mockResolvedValue(makeGuest({ id: "g1", seat_number: 7 }));
    const user = userEvent.setup();
    renderGrid(
      [makeGuest({ id: "g1", full_name: "Alice", seat_number: 2 })],
      (g) => g.party_id,
    );

    // Seat is a sibling of Table; this guards against the two near-identical
    // number cells being wired to the same field key.
    const seat = screen.getByRole("spinbutton", { name: "Seat number" });
    expect(seat).toHaveValue(2);
    await user.clear(seat);
    await user.type(seat, "7");
    await user.tab();
    await waitFor(() =>
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/g1", {
        method: "PATCH",
        body: { seat_number: "7" },
      }),
    );
  });
});

describe("GuestsGrid frozen name column", () => {
  it("pins the name cell as a sticky first column that tracks the row background", () => {
    renderFlatGrid(
      [makeGuest({ id: "g1", full_name: "Alice", party_id: "p7" })],
      [makeParty({ id: "p7" })],
    );

    // The name cell is the frozen first column: sticky so it stays put as the
    // wide flat list scrolls horizontally, and bg-inherit so it copies the row
    // background (and its hover tint) rather than letting scrolled columns bleed
    // through. Asserting the structural classes guards the cellClassName plumbing
    // from GridTextCell to the <td> without coupling to the seam's tuning values.
    const cell = screen.getByRole("textbox", { name: "Name" }).closest("td");
    expect(cell).toHaveClass("sticky", "left-0", "bg-inherit");
  });
});

describe("GuestsGrid flat list party columns", () => {
  it("renders the owning party's side as a colored chip and surfaces its attributes read-only", () => {
    renderFlatGrid(
      [makeGuest({ id: "g1", full_name: "Alice", party_id: "p7" })],
      [
        makeParty({
          id: "p7",
          name: "The Smiths",
          side: "robin",
          circle: ["College"],
          city: "Springfield",
        }),
      ],
    );

    // Side reads as a chip colored by the wire value (robin -> blue), not as
    // plain muted text. The label is "Robin", the color keys off "robin".
    const side = screen.getByText("Robin");
    expect(side).toHaveClass("bg-blue-200");

    // The rest of the owning party is surfaced read-only: the circle as a chip
    // and the mailing address. Their presence guards the party columns resolving
    // from the guest's party rather than rendering blank.
    expect(screen.getByText("College")).toBeInTheDocument();
    expect(screen.getByText("Springfield")).toBeInTheDocument();
  });
});
