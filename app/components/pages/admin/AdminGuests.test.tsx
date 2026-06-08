import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  GuestListItem,
  ListGuestsResponse,
  PartyResponse,
} from "@/types/generated/parties";

import AdminGuests from "./AdminGuests";

const adminRequest = vi.fn();
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: (...args: unknown[]) => adminRequest(...args),
  };
});

function makeGuestItem(overrides: Partial<GuestListItem>): GuestListItem {
  return {
    id: "g1",
    party_id: "p7",
    party_name: "The Smiths",
    full_name: "Guest",
    tags: [],
    is_primary: false,
    is_child: false,
    is_drinking: false,
    is_placeholder: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeParty(id: string, name: string): PartyResponse {
  return {
    id,
    name,
    side: "robin",
    relation: "family",
    circle: [],
    invitation_type: "digital",
    info_token: `tok_${id}`,
    info_collection_requested: false,
    info_collection_confirmed: false,
    info_collection_status: "incomplete",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    guests: [],
  };
}

const PARTIES = [makeParty("p7", "The Smiths"), makeParty("p8", "The Joneses")];

function listOf(items: GuestListItem[]): ListGuestsResponse {
  return { items, total: items.length };
}

// Stubs both list endpoints the page reads (guests + parties for the Party
// combobox) and resolves writes; onWrite lets a test shape the write response.
function setMock(opts: {
  guests?: GuestListItem[];
  onWrite?: (path: string, options?: { method?: string }) => unknown;
}) {
  const guests = opts.guests ?? [];
  adminRequest.mockImplementation(
    (path: string, options?: { method?: string }) => {
      const method = options?.method ?? "GET";
      if (path === "/admin/guests" && method === "GET") {
        return Promise.resolve(listOf(guests));
      }
      if (path === "/admin/parties" && method === "GET") {
        return Promise.resolve({ items: PARTIES, total: PARTIES.length });
      }
      return Promise.resolve(
        opts.onWrite?.(path, options) ?? makeGuestItem({ id: "written" }),
      );
    },
  );
}

function renderGuests() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/guests"]}>
          <AdminGuests />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminGuests flat list", () => {
  it("shows each guest's party and reassigns it via the combobox", async () => {
    setMock({
      guests: [
        makeGuestItem({
          id: "alice",
          full_name: "Alice",
          party_id: "p7",
          party_name: "The Smiths",
        }),
      ],
    });

    const user = userEvent.setup();
    renderGuests();

    // The Party cell is an editable combobox showing the guest's current party.
    const row = (await screen.findByDisplayValue("Alice")).closest("tr")!;
    const partyCell = within(row).getByRole("combobox", { name: "Party" });
    expect(partyCell).toHaveTextContent("The Smiths");

    // Reassigning the party PATCHes party_id (moving the guest to another party).
    await user.click(partyCell);
    await user.click(
      await screen.findByRole("option", { name: "The Joneses" }),
    );
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/alice", {
        method: "PATCH",
        body: { party_id: "p8" },
      });
    });
  });

  it("edits a guest cell in place, patching it with its party context", async () => {
    setMock({ guests: [makeGuestItem({ id: "alice", full_name: "Alice" })] });

    const user = userEvent.setup();
    renderGuests();

    const nameCell = await screen.findByDisplayValue("Alice");
    await user.clear(nameCell);
    await user.type(nameCell, "Alice Cooper");
    await user.tab();

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/alice", {
        method: "PATCH",
        body: { full_name: "Alice Cooper" },
      });
    });
  });

  it("toggles a flag inline, patching only that field", async () => {
    setMock({ guests: [makeGuestItem({ id: "alice", full_name: "Alice" })] });

    const user = userEvent.setup();
    renderGuests();

    const row = (await screen.findByDisplayValue("Alice")).closest("tr")!;
    await user.click(within(row).getByRole("checkbox", { name: "Drinking" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/alice", {
        method: "PATCH",
        body: { is_drinking: true },
      });
    });
  });

  it("creates and applies a new tag via the tags cell", async () => {
    setMock({
      guests: [makeGuestItem({ id: "alice", full_name: "Alice", tags: [] })],
    });

    const user = userEvent.setup();
    renderGuests();

    const row = (await screen.findByDisplayValue("Alice")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Tags" }));
    await user.type(
      screen.getByPlaceholderText("Search or add..."),
      "Bridal Party",
    );
    await user.click(
      await screen.findByRole("option", { name: /Create "Bridal Party"/ }),
    );

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/alice", {
        method: "PATCH",
        body: { tags: ["Bridal Party"] },
      });
    });
  });

  it("adds a guest from the flat list once a name and party are chosen", async () => {
    setMock({ guests: [] });

    const user = userEvent.setup();
    renderGuests();

    // The flat list also offers an add row, with a required party picker.
    await user.click(await screen.findByRole("button", { name: "Add guest" }));
    await user.type(
      screen.getByRole("textbox", { name: "New guest name" }),
      "Newbie",
    );
    await user.click(screen.getByRole("combobox", { name: "New guest party" }));
    await user.click(
      await screen.findByRole("option", { name: "The Joneses" }),
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/parties/p8/guests",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({ full_name: "Newbie" }),
        }),
      );
    });
  });
});
