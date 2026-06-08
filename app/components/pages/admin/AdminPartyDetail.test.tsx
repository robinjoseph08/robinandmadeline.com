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
  it("reflects the primary swap after checking another guest's primary cell", async () => {
    // The party starts with Alice as primary, Bob not. Checking Bob's primary
    // cell PATCHes is_primary; the API demotes Alice transactionally, which the
    // test models by flipping which guest the subsequent party GET returns.
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

    // Each guest's primary state is an inline checkbox. Initially only Alice's
    // is checked.
    const aliceRow = (await screen.findByDisplayValue("Alice")).closest("tr")!;
    const bobRow = screen.getByDisplayValue("Bob").closest("tr")!;
    expect(
      within(aliceRow).getByRole("checkbox", { name: "Primary" }),
    ).toBeChecked();
    expect(
      within(bobRow).getByRole("checkbox", { name: "Primary" }),
    ).not.toBeChecked();

    // Promote Bob by checking his primary cell.
    await user.click(within(bobRow).getByRole("checkbox", { name: "Primary" }));

    // After the refetch, exactly one primary remains and it is now Bob.
    await waitFor(() => {
      const aliceAfter = screen.getByDisplayValue("Alice").closest("tr")!;
      expect(
        within(aliceAfter).getByRole("checkbox", { name: "Primary" }),
      ).not.toBeChecked();
    });
    const bobAfter = screen.getByDisplayValue("Bob").closest("tr")!;
    expect(
      within(bobAfter).getByRole("checkbox", { name: "Primary" }),
    ).toBeChecked();

    // The promotion went through the guest PATCH with is_primary true.
    expect(adminRequest).toHaveBeenCalledWith("/admin/guests/bob", {
      method: "PATCH",
      body: { is_primary: true },
    });
  });
});

describe("AdminPartyDetail add guest", () => {
  it("creates a placeholder guest from the trailing add row", async () => {
    adminRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        const method = options?.method ?? "GET";
        if (path === "/admin/parties/p1" && method === "GET") {
          return Promise.resolve(makeParty([ALICE_PRIMARY]));
        }
        // The create POST (and any refetch) resolve to a guest.
        return Promise.resolve(makeGuest({ id: "new", is_placeholder: true }));
      },
    );

    const user = userEvent.setup();
    renderDetail();

    // Fill the add row's name, mark it a placeholder, and submit with Add.
    const addName = await screen.findByRole("textbox", {
      name: "New guest name",
    });
    await user.type(addName, "Plus One");
    await user.click(
      screen.getByRole("checkbox", { name: "New guest placeholder" }),
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/parties/p1/guests",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            full_name: "Plus One",
            is_placeholder: true,
          }),
        }),
      );
    });
  });

  it("carries the checked primary flag on every successive add-row create", async () => {
    // Regression: after a create resets the draft, the add-row cells re-seed from
    // the (now empty) draft. Re-checking primary for the next guest must still
    // commit it, rather than being dropped as a phantom no-op against a stale
    // de-dup baseline. Both creates here should carry is_primary true.
    const created: Guest[] = [];
    adminRequest.mockImplementation(
      (
        path: string,
        options?: {
          method?: string;
          body?: { full_name: string; is_primary: boolean };
        },
      ) => {
        const method = options?.method ?? "GET";
        if (path === "/admin/parties/p1" && method === "GET") {
          return Promise.resolve(makeParty(created));
        }
        if (path === "/admin/parties/p1/guests" && method === "POST") {
          const body = options?.body;
          if (body?.is_primary) created.forEach((g) => (g.is_primary = false));
          created.push(
            makeGuest({
              id: `g${created.length + 1}`,
              full_name: body?.full_name ?? "",
              is_primary: body?.is_primary ?? false,
            }),
          );
          return Promise.resolve(created[created.length - 1]);
        }
        return Promise.resolve(undefined);
      },
    );

    const user = userEvent.setup();
    renderDetail();

    const addOne = async (name: string) => {
      await user.type(
        await screen.findByRole("textbox", { name: "New guest name" }),
        name,
      );
      await user.click(
        screen.getByRole("checkbox", { name: "New guest primary" }),
      );
      await user.click(screen.getByRole("button", { name: "Add" }));
    };

    await addOne("First Primary");
    await waitFor(() =>
      expect(screen.getByDisplayValue("First Primary")).toBeInTheDocument(),
    );
    await addOne("Second Primary");
    await waitFor(() =>
      expect(screen.getByDisplayValue("Second Primary")).toBeInTheDocument(),
    );

    // Both POSTs must have carried is_primary true.
    const creates = adminRequest.mock.calls.filter(
      (call) => call[0] === "/admin/parties/p1/guests",
    );
    expect(creates).toHaveLength(2);
    expect(creates[0][1].body).toMatchObject({
      full_name: "First Primary",
      is_primary: true,
    });
    expect(creates[1][1].body).toMatchObject({
      full_name: "Second Primary",
      is_primary: true,
    });
  });
});
