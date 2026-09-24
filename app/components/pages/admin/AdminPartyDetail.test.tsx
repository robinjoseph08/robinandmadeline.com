import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { Guest } from "@/types/generated/models";
import type { GuestResponse, PartyResponse } from "@/types/generated/parties";
import type { PartyRSVPsResponse } from "@/types/generated/rsvps";

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
    subscribed: true,
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
    info_collection_status: "complete",
    missing_required_fields: [],
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

function makeRSVPView(
  overrides: Partial<PartyRSVPsResponse> = {},
): PartyRSVPsResponse {
  return {
    guests: [],
    events: [],
    responded: false,
    closed: false,
    ...overrides,
  };
}

// The detail page also loads the party's RSVP view. mockAdminRequest answers
// that GET with rsvpView so tests that don't exercise the RSVP section keep
// their catch-all mocks for everything else.
let rsvpView: PartyRSVPsResponse;

function mockAdminRequest<Options extends { method?: string }>(
  impl: (path: string, options?: Options) => Promise<unknown>,
) {
  adminRequest.mockImplementation((path: string, options?: Options) => {
    if (path === "/admin/parties/p1/rsvp" && !options?.method) {
      return Promise.resolve(rsvpView);
    }
    return impl(path, options);
  });
}

beforeEach(() => {
  adminRequest.mockReset();
  rsvpView = makeRSVPView();
});

describe("AdminPartyDetail single-primary guest editing", () => {
  it("reflects the primary swap after checking another guest's primary cell", async () => {
    // The party starts with Alice as primary, Bob not. Checking Bob's primary
    // cell PATCHes is_primary; the API demotes Alice transactionally, which the
    // test models by flipping which guest the subsequent party GET returns.
    let bobIsPrimary = false;

    mockAdminRequest((path: string, options?: { method?: string }) => {
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
    });

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
    mockAdminRequest((path: string, options?: { method?: string }) => {
      const method = options?.method ?? "GET";
      if (path === "/admin/parties/p1" && method === "GET") {
        return Promise.resolve(makeParty([ALICE_PRIMARY]));
      }
      // The request-info POST (and any refetch) resolve to the party.
      return Promise.resolve(makeParty([ALICE_PRIMARY]));
    });

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
    mockAdminRequest((path: string, options?: { method?: string }) => {
      const method = options?.method ?? "GET";
      if (path === "/admin/parties/p1" && method === "GET") {
        return Promise.resolve(makeParty([ALICE_PRIMARY]));
      }
      if (path === "/admin/parties/p1/request-info" && method === "POST") {
        return Promise.reject(new Error("request-info failed"));
      }
      return Promise.resolve(undefined);
    });

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
    mockAdminRequest((path: string, options?: { method?: string }) => {
      const method = options?.method ?? "GET";
      if (path === "/admin/parties/p1" && method === "GET") {
        return Promise.resolve(makeParty([ALICE_PRIMARY]));
      }
      // The create POST (and any refetch) resolve to a guest.
      return Promise.resolve(
        makeGuest({ id: "new", placeholder_text: "Guest of Alice" }),
      );
    });

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
    mockAdminRequest(
      (
        path: string,
        options?: {
          method?: string;
          body?: { full_name: string; is_primary: boolean };
        },
      ) => {
        const method = options?.method ?? "GET";
        if (path === "/admin/parties/p1" && method === "GET") {
          // Return a fresh copy each request, the way a real API serializes new
          // JSON: React Query then sees the added guest and re-renders. Returning
          // the mutated-in-place `created` array would be reference-equal to what
          // the cache already holds, so the new row would never appear.
          return Promise.resolve(makeParty(created.map((g) => ({ ...g }))));
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
    mockAdminRequest((path: string, options?: { method?: string }) => {
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
    });

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

describe("AdminPartyDetail tag suggestions", () => {
  it("offers the global tag vocabulary, not just this party's own", async () => {
    // This party's only guest carries no tags, but the tag vocabulary endpoint
    // reports "Groomsman" (used elsewhere). Editing a guest here must offer it,
    // so an existing tag can be applied even though no guest in this party uses
    // it.
    const alice = makeGuest({ id: "alice", full_name: "Alice", tags: [] });

    mockAdminRequest((path: string, options?: { method?: string }) => {
      const method = options?.method ?? "GET";
      if (path === "/admin/parties/p1" && method === "GET") {
        return Promise.resolve(makeParty([alice]));
      }
      // The detail page reads the tag vocabulary from its own endpoint, not
      // from the party's guests.
      if (path === "/admin/guests/tags" && method === "GET") {
        return Promise.resolve({ items: ["Groomsman"], total: 1 });
      }
      return Promise.resolve(undefined);
    });

    const user = userEvent.setup();
    renderDetail();

    // Open Alice's tag cell once her row has loaded.
    const aliceRow = (await screen.findByDisplayValue("Alice")).closest("tr")!;
    await user.click(within(aliceRow).getByRole("button", { name: "Tags" }));

    // The cross-party tag is offered even though no guest in this party has it.
    expect(
      await screen.findByRole("option", { name: /Groomsman/ }),
    ).toBeInTheDocument();
  });
});

describe("AdminPartyDetail RSVPs", () => {
  const CEREMONY = {
    id: "ceremony",
    name: "Ceremony",
    date: "2026-10-17",
    is_public: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  const REHEARSAL = { ...CEREMONY, id: "rehearsal", name: "Rehearsal Dinner" };

  it("shows each guest's status per event, and who is not invited", async () => {
    rsvpView = makeRSVPView({
      guests: [
        { id: "alice", full_name: "Alice" },
        { id: "bob", full_name: "Bob" },
      ],
      events: [
        {
          ...REHEARSAL,
          rsvps: [{ guest_id: "alice", status: "not_attending" }],
        },
        {
          ...CEREMONY,
          rsvps: [
            { guest_id: "alice", status: "attending" },
            { guest_id: "bob", status: "pending" },
          ],
        },
      ],
    });
    mockAdminRequest((path) =>
      path === "/admin/parties/p1"
        ? Promise.resolve(makeParty([ALICE_PRIMARY, BOB]))
        : Promise.resolve(undefined),
    );

    renderDetail();

    const grid = (
      await screen.findByRole("columnheader", { name: "Rehearsal Dinner" })
    ).closest("table")!;
    const aliceRow = within(grid).getByRole("cell", {
      name: "Alice",
    }).parentElement!;
    const bobRow = within(grid).getByRole("cell", {
      name: "Bob",
    }).parentElement!;
    expect(within(aliceRow).getByText("Not attending")).toBeInTheDocument();
    expect(within(aliceRow).getByText("Attending")).toBeInTheDocument();
    expect(within(bobRow).getByText("Not invited")).toBeInTheDocument();
    expect(within(bobRow).getByText("Pending")).toBeInTheDocument();
  });

  it("records the whole party's response through the admin endpoint", async () => {
    rsvpView = makeRSVPView({
      closed: true,
      guests: [
        { id: "alice", full_name: "Alice" },
        {
          id: "plus-one",
          full_name: "Guest of Alice",
          placeholder_text: "Guest of Alice",
        },
      ],
      events: [
        {
          ...CEREMONY,
          rsvps: [
            { guest_id: "alice", status: "pending" },
            { guest_id: "plus-one", status: "pending" },
          ],
        },
      ],
    });
    mockAdminRequest((path, options) => {
      if (path === "/admin/parties/p1" && !options?.method) {
        return Promise.resolve(makeParty([ALICE_PRIMARY]));
      }
      if (path === "/admin/parties/p1/rsvp" && options?.method === "PUT") {
        return Promise.resolve(rsvpView);
      }
      return Promise.resolve(undefined);
    });

    const user = userEvent.setup();
    renderDetail();

    await user.click(
      await screen.findByRole("button", { name: "Record RSVP" }),
    );
    const dialog = await screen.findByRole("dialog");
    // Past the deadline the couple can still record a response.
    expect(
      within(dialog).getByText(/deadline has passed, but you can still/),
    ).toBeInTheDocument();

    const alice = within(dialog).getByRole("region", { name: "Alice" });
    await user.click(
      within(alice).getByRole("button", { name: "Ceremony: attending" }),
    );
    await user.type(
      within(alice).getByLabelText("Dietary restrictions"),
      "vegetarian",
    );
    const plusOne = within(dialog).getByRole("region", {
      name: "Guest of Alice",
    });
    await user.type(within(plusOne).getByLabelText("Name"), "Bob Jones");
    await user.click(
      within(plusOne).getByRole("button", { name: "Ceremony: not attending" }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Save RSVP" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/parties/p1/rsvp", {
        method: "PUT",
        body: {
          guests: [
            {
              guest_id: "alice",
              full_name: undefined,
              dietary_restrictions: "vegetarian",
              rsvps: [{ event_id: "ceremony", status: "attending" }],
            },
            {
              guest_id: "plus-one",
              full_name: "Bob Jones",
              dietary_restrictions: undefined,
              rsvps: [{ event_id: "ceremony", status: "not_attending" }],
            },
          ],
        },
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("seeds the dialog from a fresh read, not the page's cached view", async () => {
    // The page loads while Alice is still pending; by the time the dialog
    // opens she has answered online. The form must start from her answer so
    // saving cannot silently revert it.
    rsvpView = makeRSVPView({
      guests: [{ id: "alice", full_name: "Alice" }],
      events: [
        { ...CEREMONY, rsvps: [{ guest_id: "alice", status: "pending" }] },
      ],
    });
    mockAdminRequest((path) =>
      path === "/admin/parties/p1"
        ? Promise.resolve(makeParty([ALICE_PRIMARY]))
        : Promise.resolve(undefined),
    );

    const user = userEvent.setup();
    renderDetail();
    await screen.findByRole("columnheader", { name: "Ceremony" });

    rsvpView = makeRSVPView({
      guests: [{ id: "alice", full_name: "Alice" }],
      events: [
        { ...CEREMONY, rsvps: [{ guest_id: "alice", status: "attending" }] },
      ],
    });
    await user.click(screen.getByRole("button", { name: "Record RSVP" }));

    const dialog = await screen.findByRole("dialog");
    expect(
      await within(dialog).findByRole("button", {
        name: "Ceremony: attending",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("disables recording when the party is not invited to anything", async () => {
    mockAdminRequest((path) =>
      path === "/admin/parties/p1"
        ? Promise.resolve(makeParty([ALICE_PRIMARY]))
        : Promise.resolve(undefined),
    );

    renderDetail();

    expect(
      await screen.findByText("This party is not invited to any events yet."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Record RSVP" })).toBeDisabled();
  });
});
