import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { PartyResponse } from "@/types/generated/parties";

import { PartiesGrid } from "./PartiesGrid";

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
    name: "Party",
    side: "robin",
    relation: "family",
    circle: [],
    invitation_type: "digital",
    info_token: "tok",
    info_collection_requested: false,
    info_collection_confirmed: false,
    info_collection_status: "incomplete",
    missing_required_fields: ["primary guest's email"],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    guests: [],
    ...overrides,
  };
}

function renderGrid(parties: PartyResponse[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <PartiesGrid onEditParty={() => {}} parties={parties} />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
  adminRequest.mockResolvedValue(undefined);
});

describe("PartiesGrid keyboard navigation", () => {
  it("commits on Enter and moves focus to the same column one row down", async () => {
    const user = userEvent.setup();
    renderGrid([
      makeParty({ id: "p1", name: "First" }),
      makeParty({ id: "p2", name: "Second" }),
    ]);

    const first = screen.getByDisplayValue("First");
    const second = screen.getByDisplayValue("Second");

    first.focus();
    await user.clear(first);
    await user.type(first, "Firsty{Enter}");

    // Enter commits the edited cell as a single-field PATCH...
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/parties/p1", {
        method: "PATCH",
        body: { name: "Firsty" },
      });
    });
    // ...and moves focus straight down to the next row's name cell.
    expect(second).toHaveFocus();
  });

  it("reverts the cell and saves nothing on Escape", async () => {
    const user = userEvent.setup();
    renderGrid([makeParty({ id: "p1", name: "Keep" })]);

    const cell = screen.getByDisplayValue("Keep");
    await user.clear(cell);
    await user.type(cell, "Discard{Escape}");

    // Escape restores the server value and never fires a name PATCH.
    expect(cell).toHaveValue("Keep");
    expect(adminRequest).not.toHaveBeenCalledWith(
      "/admin/parties/p1",
      expect.objectContaining({ body: { name: "Discard" } }),
    );
  });
});

describe("PartiesGrid racing commits", () => {
  it("ignores a stale failure after a newer commit on the same cell succeeded", async () => {
    // Two commits race on one cell: the second PATCH settles first (success),
    // then the first rejects late. The stale rejection must not roll the cell
    // back to the original value or tint it as an error; the server holds the
    // second value.
    const patches: {
      resolve: (value: PartyResponse) => void;
      reject: (error: Error) => void;
    }[] = [];
    adminRequest.mockImplementation(
      (_path: string, options?: { method?: string }) => {
        if (options?.method === "PATCH") {
          return new Promise((resolve, reject) => {
            patches.push({ resolve, reject });
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const user = userEvent.setup();
    renderGrid([makeParty({ id: "p1", name: "Original" })]);

    const cell = screen.getByDisplayValue("Original");
    await user.clear(cell);
    await user.type(cell, "First{Enter}");
    await user.clear(cell);
    await user.type(cell, "Second{Enter}");
    expect(patches).toHaveLength(2);

    patches[1].resolve(makeParty({ id: "p1", name: "Second" }));
    await act(async () => {});
    patches[0].reject(new Error("Stale failure"));
    await act(async () => {});

    expect(cell).toHaveValue("Second");
    expect(cell.closest("td")).not.toHaveClass("bg-destructive/10");
  });
});

describe("PartiesGrid address columns", () => {
  it("patches an address cell under its own key", async () => {
    const user = userEvent.setup();
    renderGrid([makeParty({ id: "p1", name: "Fam" })]);

    // The six mailing-address cells are near-identical; this guards City against
    // being wired to another field's key (e.g. state_or_province).
    const city = screen.getByRole("textbox", { name: "City" });
    await user.type(city, "Springfield");
    await user.tab();

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/parties/p1", {
        method: "PATCH",
        body: { city: "Springfield" },
      });
    });
  });
});
