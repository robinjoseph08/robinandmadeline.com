import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { PartyResponse } from "@/types/generated/parties";

import AdminParties from "./AdminParties";

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

function makeParty(overrides: Partial<PartyResponse>): PartyResponse {
  return {
    id: "p1",
    name: "Party One",
    side: "robin",
    relation: "family",
    circle: [],
    invitation_type: "digital",
    info_token: "tok_one",
    info_collection_requested: false,
    info_collection_confirmed: false,
    info_collection_status: "incomplete",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    guests: [],
    ...overrides,
  };
}

function renderParties() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminParties />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

const ROBIN_PARTY = makeParty({ id: "p-robin", name: "Robin's Party" });
const MADELINE_PARTY = makeParty({
  id: "p-madeline",
  name: "Madeline's Party",
  side: "madeline",
});

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminParties filters", () => {
  it("narrows the grid to the side filter the admin selects", async () => {
    // Route the list response off the side filter so selecting "Madeline"
    // returns only her party. The first call (no filter) returns both.
    adminRequest.mockImplementation(
      (path: string, options?: { query?: { side?: string } }) => {
        if (path === "/admin/parties") {
          const side = options?.query?.side;
          if (side === "madeline") {
            return Promise.resolve({ items: [MADELINE_PARTY], total: 1 });
          }
          return Promise.resolve({
            items: [ROBIN_PARTY, MADELINE_PARTY],
            total: 2,
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const user = userEvent.setup();
    renderParties();

    // Each party name is an editable cell, so rows are identified by the input's
    // value. Initially both parties show.
    expect(
      await screen.findByDisplayValue("Robin's Party"),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue("Madeline's Party")).toBeInTheDocument();

    // Select Side = Madeline from the filter bar (scoped so it is not confused
    // with the per-row Side cells, which share the "Side" label).
    const filters = screen.getByRole("group", { name: "Filters" });
    await user.click(within(filters).getByRole("combobox", { name: "Side" }));
    await user.click(await screen.findByRole("option", { name: "Madeline" }));

    // The list refetches with the side filter and narrows to Madeline's party.
    await waitFor(() => {
      expect(
        screen.queryByDisplayValue("Robin's Party"),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Madeline's Party")).toBeInTheDocument();

    // The last list request carried the side filter.
    const listCalls = adminRequest.mock.calls.filter(
      (call) => call[0] === "/admin/parties",
    );
    const lastListCall = listCalls[listCalls.length - 1];
    expect(lastListCall?.[1]?.query).toMatchObject({ side: "madeline" });
  });
});

describe("AdminParties inline editing", () => {
  it("saves a single cell via PATCH when it loses focus", async () => {
    adminRequest.mockImplementation((path: string) => {
      if (path === "/admin/parties") {
        return Promise.resolve({ items: [ROBIN_PARTY], total: 1 });
      }
      return Promise.resolve(makeParty({ id: "p-robin" }));
    });

    const user = userEvent.setup();
    renderParties();

    const nameCell = await screen.findByDisplayValue("Robin's Party");
    await user.clear(nameCell);
    await user.type(nameCell, "The Robins");
    await user.tab(); // blur commits the cell

    // Leaving the cell PATCHes just the edited field for that party.
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/parties/p-robin", {
        method: "PATCH",
        body: { name: "The Robins" },
      });
    });
  });

  it("has no add-party row, since parties are created from the guest list", async () => {
    adminRequest.mockResolvedValue({ items: [ROBIN_PARTY], total: 1 });
    renderParties();

    // Parties are now born from a guest (the guest list creates them), so the
    // parties grid only manages existing ones and offers no add row.
    await screen.findByDisplayValue("Robin's Party");
    expect(
      screen.queryByRole("button", { name: "Add party" }),
    ).not.toBeInTheDocument();
  });
});

describe("AdminParties copy info link", () => {
  it("triggers request-info when the info link is copied", async () => {
    adminRequest.mockImplementation((path: string) => {
      if (path === "/admin/parties") {
        return Promise.resolve({ items: [ROBIN_PARTY], total: 1 });
      }
      // request-info endpoint
      return Promise.resolve(makeParty({ id: "p-robin" }));
    });

    const user = userEvent.setup();

    // Override the clipboard AFTER userEvent.setup(), which installs its own
    // clipboard stub; navigator.clipboard is getter-only in jsdom so define it.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderParties();

    const row = (await screen.findByDisplayValue("Robin's Party")).closest(
      "tr",
    )!;
    await user.click(within(row).getByRole("button", { name: /info link/i }));

    // Copying the info link POSTs to request-info for that party (per the spec),
    // then writes the link to the clipboard.
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/parties/p-robin/request-info",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/i/tok_one"),
      );
    });
  });
});
