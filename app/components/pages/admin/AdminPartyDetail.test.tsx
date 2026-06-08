import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Guest } from "@/types/generated/models";
import type { GuestResponse, PartyResponse } from "@/types/generated/parties";

import AdminPartyDetail from "./AdminPartyDetail";

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
    party_id: "p1",
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

function makeParty(guests: Guest[]): PartyResponse {
  return {
    id: "p1",
    name: "The Party",
    side: "robin",
    relation: "family",
    circle: [],
    invitation_type: "digital",
    info_token: "tok",
    info_collection_requested: false,
    info_collection_confirmed: false,
    info_collection_status: "incomplete",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    guests,
  };
}

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/parties/p1"]}>
        <Routes>
          <Route element={<AdminPartyDetail />} path="/admin/parties/:id" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ALICE_PRIMARY = makeGuest({
  id: "alice",
  full_name: "Alice",
  email: "alice@example.com",
  is_primary: true,
});
const BOB = makeGuest({ id: "bob", full_name: "Bob", is_primary: false });

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminPartyDetail single-primary guest editing", () => {
  it("reflects the primary swap after promoting another guest", async () => {
    // The party starts with Alice as primary, Bob not. Promoting Bob through the
    // PATCH causes the API to demote Alice transactionally; the test models that
    // by flipping which guest the subsequent party GET returns as primary.
    let bobIsPrimary = false;

    adminRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        const method = options?.method ?? "GET";
        if (path === "/admin/parties/p1" && method === "GET") {
          const guests = bobIsPrimary
            ? [
                makeGuest({ ...ALICE_PRIMARY, is_primary: false }),
                makeGuest({ ...BOB, is_primary: true }),
              ]
            : [ALICE_PRIMARY, BOB];
          return Promise.resolve(makeParty(guests));
        }
        if (path === "/admin/guests/bob" && method === "PATCH") {
          bobIsPrimary = true;
          const response: GuestResponse = makeGuest({
            ...BOB,
            is_primary: true,
          });
          return Promise.resolve(response);
        }
        return Promise.resolve(undefined);
      },
    );

    const user = userEvent.setup();
    renderDetail();

    // Wait for the table, then confirm exactly one primary badge (Alice).
    await screen.findByText("Alice");
    expect(screen.getAllByText("Primary")).toHaveLength(1);
    const aliceRow = screen.getByText("Alice").closest("tr")!;
    expect(within(aliceRow).getByText("Primary")).toBeInTheDocument();

    // Open Bob's edit dialog and promote him to primary.
    const bobRow = screen.getByText("Bob").closest("tr")!;
    await user.click(within(bobRow).getByRole("button", { name: /edit bob/i }));

    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("checkbox", { name: /primary guest/i }),
    );
    await user.click(within(dialog).getByRole("button", { name: /save/i }));

    // After the refetch, exactly one primary remains and it is now Bob.
    await waitFor(() => {
      const bobRowAfter = screen.getByText("Bob").closest("tr")!;
      expect(within(bobRowAfter).getByText("Primary")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Primary")).toHaveLength(1);

    // The promotion went through the guest PATCH with is_primary true.
    expect(adminRequest).toHaveBeenCalledWith(
      "/admin/guests/bob",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({ is_primary: true }),
      }),
    );
  });
});
