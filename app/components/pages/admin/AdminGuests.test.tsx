import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { toast } from "sonner";
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
    placeholder_text: undefined,
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
    missing_required_fields: ["primary guest's email"],
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

// Exposes the router's live query string so tests can assert URL behavior
// (e.g. Clear all preserving params the page does not own).
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

// Buttons that navigate like an external actor: a PUSH (a link click) and a
// REPLACE (the shape of the page's own filter writes), for the search-box
// resync tests.
function NavProbe() {
  const navigate = useNavigate();
  return (
    <>
      <button onClick={() => void navigate("?search=external")} type="button">
        push-nav
      </button>
      <button
        onClick={() => void navigate("?search=stale", { replace: true })}
        type="button"
      >
        replace-nav
      </button>
    </>
  );
}

function renderGuests(path = "/admin/guests") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <AdminGuests />
          <LocationProbe />
          <NavProbe />
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

  it("toggles a flag via the flags cell, patching the flag set", async () => {
    setMock({ guests: [makeGuestItem({ id: "alice", full_name: "Alice" })] });

    const user = userEvent.setup();
    renderGuests();

    // The child/drinking flags live in one chip cell now; toggling Drinking
    // and closing the popover commits the whole flag set.
    const row = (await screen.findByDisplayValue("Alice")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Flags" }));
    await user.click(await screen.findByRole("option", { name: /Drinking/ }));
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/alice", {
        method: "PATCH",
        body: { is_child: false, is_drinking: true },
      });
    });
  });

  it("edits the placeholder text cell, and clearing it patches a blank", async () => {
    setMock({
      guests: [
        makeGuestItem({
          id: "dana",
          full_name: "Dana Lee",
          placeholder_text: "Guest of Alice",
        }),
      ],
    });

    const user = userEvent.setup();
    renderGuests();

    // The placeholder descriptor is an editable text cell (the slot stays
    // retargetable after a swap)...
    const row = (await screen.findByDisplayValue("Dana Lee")).closest("tr")!;
    const cell = within(row).getByRole("textbox", {
      name: "Placeholder text",
    });
    expect(cell).toHaveValue("Guest of Alice");
    await user.clear(cell);
    await user.type(cell, "Guest of Bob");
    await user.tab();

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/dana", {
        method: "PATCH",
        body: { placeholder_text: "Guest of Bob" },
      });
    });

    // ...and clearing the cell sends a blank, which the API stores as NULL,
    // turning the row into a regular guest.
    await user.clear(cell);
    await user.tab();

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/dana", {
        method: "PATCH",
        body: { placeholder_text: "" },
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

  it("keeps a selected tag toggleable when another guest has it in different casing", async () => {
    // Bob is listed first, so the shared suggestion list canonicalizes on his
    // lowercase casing; Alice's popover must still list her selected casing
    // once, checked, rather than an untoggleable lowercase twin.
    setMock({
      guests: [
        makeGuestItem({ id: "bob", full_name: "Bob", tags: ["vip"] }),
        makeGuestItem({ id: "alice", full_name: "Alice", tags: ["VIP"] }),
      ],
    });

    const user = userEvent.setup();
    renderGuests();

    const row = (await screen.findByDisplayValue("Alice")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Tags" }));

    const options = await screen.findAllByRole("option");
    const vipOptions = options.filter((o) => /vip/i.test(o.textContent ?? ""));
    expect(vipOptions).toHaveLength(1);
    expect(vipOptions[0]).toHaveTextContent("VIP");

    // Toggling the listed entry removes the selected tag instead of stacking a
    // duplicate in the other casing.
    await user.click(vipOptions[0]);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/guests/alice", {
        method: "PATCH",
        body: { tags: [] },
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

  it("discards the add row on Escape while it is still untouched", async () => {
    setMock({ guests: [] });

    const user = userEvent.setup();
    renderGuests();

    await user.click(await screen.findByRole("button", { name: "Add guest" }));
    const nameField = screen.getByRole("textbox", { name: "New guest name" });
    expect(nameField).toBeInTheDocument();

    // Escape on a pristine row exits add mode and brings the affordance back.
    await user.click(nameField);
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "New guest name" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Add guest" }),
    ).toBeInTheDocument();
  });

  it("keeps an in-progress add row on Escape rather than discarding what was typed", async () => {
    setMock({ guests: [] });

    const user = userEvent.setup();
    renderGuests();

    await user.click(await screen.findByRole("button", { name: "Add guest" }));
    const nameField = screen.getByRole("textbox", { name: "New guest name" });
    await user.type(nameField, "Half Typed");

    // A stray Escape on a dirty row must not throw away the entry.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("textbox", { name: "New guest name" })).toHaveValue(
      "Half Typed",
    );
  });

  it("names the missing required fields when Enter is pressed too early", async () => {
    const errorSpy = vi.spyOn(toast, "error");
    setMock({ guests: [] });

    const user = userEvent.setup();
    renderGuests();

    await user.click(await screen.findByRole("button", { name: "Add guest" }));
    const nameField = screen.getByRole("textbox", { name: "New guest name" });

    // The Add button is disabled while the row is incomplete, so Enter is the
    // only way to submit early; it must report what is missing rather than
    // silently doing nothing. With neither a name nor a party, both are named.
    await user.click(nameField);
    await user.keyboard("{Enter}");
    expect(errorSpy).toHaveBeenCalledWith(
      "Missing required fields: name, party",
    );
    errorSpy.mockRestore();
  });

  it("uses a backend-valid example as the add-row phone placeholder", async () => {
    setMock({ guests: [] });

    const user = userEvent.setup();
    renderGuests();

    await user.click(await screen.findByRole("button", { name: "Add guest" }));
    // The example must be a real, dialable number (area code 555 is not), so an
    // admin who copies the placeholder verbatim is not rejected by the phone
    // validator.
    expect(
      screen.getByRole("textbox", { name: "New guest phone" }),
    ).toHaveAttribute("placeholder", "e.g. (415) 555-2671");
  });

  it("applies a party filter from the URL, so a filtered view is shareable", async () => {
    setMock({ guests: [] });
    // Loading a URL that already carries the filter must apply it on the first
    // fetch (filters live in the query string).
    renderGuests("/admin/guests?party_id=p8");

    await waitFor(() => {
      const guestCalls = adminRequest.mock.calls.filter(
        (call) => call[0] === "/admin/guests",
      );
      expect(guestCalls.some((call) => call[1]?.query?.party_id === "p8")).toBe(
        true,
      );
    });
  });

  it("ignores unknown URL params instead of forwarding them to the API", async () => {
    setMock({ guests: [makeGuestItem({ id: "alice", full_name: "Alice" })] });
    // A shared link can carry foreign params (a utm_ tag); the binder 422s
    // unknown query keys, so they must never reach the API, and the page must
    // still render its rows.
    const user = userEvent.setup();
    renderGuests("/admin/guests?utm_source=share&party_id=p8");

    expect(await screen.findByDisplayValue("Alice")).toBeInTheDocument();

    const guestCalls = adminRequest.mock.calls.filter(
      (call) => call[0] === "/admin/guests",
    );
    expect(guestCalls.length).toBeGreaterThan(0);
    // The known filter is forwarded; the foreign param never is.
    expect(guestCalls.some((call) => call[1]?.query?.party_id === "p8")).toBe(
      true,
    );
    expect(
      guestCalls.every((call) => !("utm_source" in (call[1]?.query ?? {}))),
    ).toBe(true);

    // Clear all drops only the known filters; the foreign param is not the
    // page's to clear, so it survives in the URL.
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.click(await screen.findByRole("button", { name: "Clear all" }));
    await waitFor(() => {
      expect(screen.getByTestId("location-search")).not.toHaveTextContent(
        "party_id",
      );
    });
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "utm_source=share",
    );
  });

  it("rolls the cell back, tints it, and toasts when the PATCH fails", async () => {
    const errorSpy = vi.spyOn(toast, "error");
    adminRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        const method = options?.method ?? "GET";
        if (path === "/admin/guests" && method === "GET") {
          return Promise.resolve(
            listOf([makeGuestItem({ id: "alice", full_name: "Alice" })]),
          );
        }
        if (path === "/admin/parties" && method === "GET") {
          return Promise.resolve({ items: PARTIES, total: PARTIES.length });
        }
        if (method === "PATCH") {
          return Promise.reject(new Error("Save failed"));
        }
        return Promise.resolve(undefined);
      },
    );

    const user = userEvent.setup();
    renderGuests();

    const nameCell = await screen.findByDisplayValue("Alice");
    await user.clear(nameCell);
    await user.type(nameCell, "Alice Cooper");
    await user.tab();

    // The rejected PATCH rolls the cell back to the value the server holds...
    await waitFor(() => {
      expect(nameCell).toHaveValue("Alice");
    });
    // ...marks the cell with the error tint...
    expect(nameCell.closest("td")).toHaveClass("bg-destructive/10");
    // ...and surfaces the failure as a toast.
    expect(errorSpy).toHaveBeenCalledWith("Save failed");
    errorSpy.mockRestore();
  });

  it("searches guests, debounced into the request query", async () => {
    setMock({ guests: [] });

    const user = userEvent.setup();
    renderGuests();

    await user.type(
      await screen.findByRole("textbox", { name: "Search guests" }),
      "smith",
    );

    // The debounced search term lands in the guest list request as `search`.
    await waitFor(() => {
      const guestCalls = adminRequest.mock.calls.filter(
        (call) => call[0] === "/admin/guests",
      );
      expect(
        guestCalls.some((call) => call[1]?.query?.search === "smith"),
      ).toBe(true);
    });
  });

  it("resyncs the search box from an external (PUSH) navigation", async () => {
    setMock({ guests: [] });

    const user = userEvent.setup();
    renderGuests();
    const box = await screen.findByRole("textbox", { name: "Search guests" });

    // A link-style navigation carrying a search lands in the box (the user
    // never typed; the URL is the source of truth here).
    await user.click(screen.getByRole("button", { name: "push-nav" }));
    await waitFor(() => expect(box).toHaveValue("external"));
  });

  it("does not let a REPLACE commit clobber newer typing in the search box", async () => {
    setMock({ guests: [] });

    const user = userEvent.setup();
    renderGuests();
    const box = await screen.findByRole("textbox", { name: "Search guests" });

    // The page's own writes are all REPLACE navigations, and under a heavy
    // render react-router can commit one long after the user has typed a
    // newer search. The replace-nav stands in for that late commit: it must
    // not overwrite the box (which would also stop the newer value from ever
    // being written, since the debounce only writes when box and URL differ).
    await user.type(box, "fresh");
    await user.click(screen.getByRole("button", { name: "replace-nav" }));
    expect(box).toHaveValue("fresh");

    // The debounce then writes the newer typing over the stale URL value.
    await waitFor(() => {
      expect(screen.getByTestId("location-search")).toHaveTextContent(
        "search=fresh",
      );
    });
  });
});
