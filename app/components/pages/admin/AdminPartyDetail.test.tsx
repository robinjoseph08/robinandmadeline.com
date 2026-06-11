import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
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
    tags: [],
    is_primary: false,
    is_child: false,
    is_drinking: false,
    placeholder_text: undefined,
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
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/admin/parties/p1"]}>
          <Routes>
            <Route element={<AdminPartyDetail />} path="/admin/parties/:id" />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
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

describe("AdminPartyDetail copy info link", () => {
  it("requests info first, then copies the link", async () => {
    adminRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        const method = options?.method ?? "GET";
        if (path === "/admin/parties/p1" && method === "GET") {
          return Promise.resolve(makeParty([ALICE_PRIMARY]));
        }
        // The request-info POST (and any refetch) resolve to the party.
        return Promise.resolve(makeParty([ALICE_PRIMARY]));
      },
    );

    const user = userEvent.setup();
    // Override the clipboard AFTER userEvent.setup(), which installs its own
    // clipboard stub; navigator.clipboard is getter-only in jsdom so define it.
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderDetail();

    await user.click(
      await screen.findByRole("button", { name: "Copy info link" }),
    );

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/parties/p1/request-info",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/i/tok"));
    });
  });

  it("aborts the copy when request-info fails", async () => {
    adminRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        const method = options?.method ?? "GET";
        if (path === "/admin/parties/p1" && method === "GET") {
          return Promise.resolve(makeParty([ALICE_PRIMARY]));
        }
        if (path === "/admin/parties/p1/request-info" && method === "POST") {
          return Promise.reject(new Error("request-info failed"));
        }
        return Promise.resolve(undefined);
      },
    );

    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    renderDetail();

    await user.click(
      await screen.findByRole("button", { name: "Copy info link" }),
    );

    // The failed request-info aborts the copy, so the link is never written to
    // the clipboard (and no success toast can claim the party was marked).
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/parties/p1/request-info",
        expect.objectContaining({ method: "POST" }),
      );
    });
    expect(writeText).not.toHaveBeenCalled();
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
        return Promise.resolve(
          makeGuest({ id: "new", placeholder_text: "Guest of Alice" }),
        );
      },
    );

    const user = userEvent.setup();
    renderDetail();

    // Open the add row, fill the name, give it a placeholder descriptor via
    // the placeholder text cell, submit with Add.
    await user.click(await screen.findByRole("button", { name: "Add guest" }));
    const addName = screen.getByRole("textbox", { name: "New guest name" });
    await user.type(addName, "Guest of Alice");
    await user.type(
      screen.getByRole("textbox", { name: "New guest placeholder text" }),
      "Guest of Alice",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/parties/p1/guests",
        expect.objectContaining({
          method: "POST",
          body: expect.objectContaining({
            full_name: "Guest of Alice",
            placeholder_text: "Guest of Alice",
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

    // Open the add row once; it stays open across creates for rapid entry.
    await user.click(await screen.findByRole("button", { name: "Add guest" }));

    const addOne = async (name: string) => {
      await user.type(
        screen.getByRole("textbox", { name: "New guest name" }),
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

  it("creates once when Enter is pressed again while the create is pending", async () => {
    // Hold the create POST unresolved: a second Enter during that latency must
    // not fire a duplicate create (the Add button disables itself, but the
    // Enter path needs its own guard).
    let resolveCreate: (guest: Guest) => void = () => {};
    adminRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        const method = options?.method ?? "GET";
        if (path === "/admin/parties/p1" && method === "GET") {
          return Promise.resolve(makeParty([ALICE_PRIMARY]));
        }
        if (path === "/admin/parties/p1/guests" && method === "POST") {
          return new Promise<Guest>((resolve) => {
            resolveCreate = resolve;
          });
        }
        return Promise.resolve(undefined);
      },
    );

    const user = userEvent.setup();
    renderDetail();

    await user.click(await screen.findByRole("button", { name: "Add guest" }));
    await user.type(
      screen.getByRole("textbox", { name: "New guest name" }),
      "Speedy",
    );
    await user.keyboard("{Enter}");
    await user.keyboard("{Enter}");

    const creates = adminRequest.mock.calls.filter(
      (call) => call[0] === "/admin/parties/p1/guests",
    );
    expect(creates).toHaveLength(1);

    // Release the held create; the add row resets for the next guest.
    resolveCreate(makeGuest({ id: "new", full_name: "Speedy" }));
    await waitFor(() => {
      expect(
        screen.getByRole("textbox", { name: "New guest name" }),
      ).toHaveValue("");
    });
  });
});
