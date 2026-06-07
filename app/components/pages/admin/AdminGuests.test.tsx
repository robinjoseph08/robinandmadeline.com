import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GuestListItem,
  ListGuestsResponse,
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
    party_id: "p1",
    party_name: "The Party",
    full_name: "Guest",
    roles: [],
    is_primary: false,
    is_child: false,
    is_drinking: false,
    is_placeholder: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function listOf(items: GuestListItem[]): ListGuestsResponse {
  return { items, total: items.length };
}

// Renders AdminGuests with the party-detail route registered too, so we can
// assert the party-name link actually targets the party detail page.
function renderGuests() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/guests"]}>
        <Routes>
          <Route element={<AdminGuests />} path="/admin/guests" />
          <Route
            element={<div>Party detail page</div>}
            path="/admin/parties/:id"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminGuests flat list", () => {
  it("links each guest to its owning party by name", async () => {
    adminRequest.mockResolvedValue(
      listOf([
        makeGuestItem({
          id: "g1",
          full_name: "Alice",
          party_id: "p7",
          party_name: "The Smiths",
        }),
      ]),
    );

    const user = userEvent.setup();
    renderGuests();

    // The Party cell is a link carrying the party name and pointing at the
    // party's detail route (guests have no detail page of their own).
    const link = await screen.findByRole("link", { name: "The Smiths" });
    expect(link).toHaveAttribute("href", "/admin/parties/p7");

    // Following it lands on the party detail route.
    await user.click(link);
    expect(await screen.findByText("Party detail page")).toBeInTheDocument();
  });

  it("edits a guest in place, patching it with its party context", async () => {
    adminRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        const method = options?.method ?? "GET";
        if (path === "/admin/guests" && method === "GET") {
          return Promise.resolve(
            listOf([
              makeGuestItem({
                id: "alice",
                full_name: "Alice",
                party_id: "p1",
                party_name: "The Party",
              }),
            ]),
          );
        }
        // The PATCH (and any post-mutation refetch) resolve to a value.
        return Promise.resolve(makeGuestItem({ id: "alice" }));
      },
    );

    const user = userEvent.setup();
    renderGuests();

    // Open Alice's edit dialog from her row and rename her.
    const aliceRow = (await screen.findByText("Alice")).closest("tr")!;
    await user.click(
      within(aliceRow).getByRole("button", { name: /edit alice/i }),
    );

    const dialog = await screen.findByRole("dialog");
    const nameInput = within(dialog).getByLabelText(/full name/i);
    await user.clear(nameInput);
    await user.type(nameInput, "Alice Cooper");
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    // The edit went through the guest PATCH for the right guest, carrying the
    // new name and the row's party_id context.
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/guests/alice",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({ full_name: "Alice Cooper" }),
        }),
      );
    });
  });
});
