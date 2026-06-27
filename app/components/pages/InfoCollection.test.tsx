import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import InfoCollection from "@/components/pages/InfoCollection";
import { ApiError } from "@/libraries/api";
import type {
  PartyInfoResponse,
  UpdatePartyInfoPayload,
} from "@/types/generated/info";

const apiRequest = vi.fn();
vi.mock("@/libraries/api", async () => {
  const actual = await vi.importActual<object>("@/libraries/api");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  };
});

function makeData(
  overrides: Partial<PartyInfoResponse> = {},
): PartyInfoResponse {
  return {
    invitation_type: "physical",
    address_line_1: undefined,
    address_line_2: undefined,
    city: undefined,
    state_or_province: undefined,
    postal_code: undefined,
    // A US party by default: the country field stays hidden for these (the
    // common case). Tests that exercise the international/unknown path override
    // this.
    country: "United States",
    // No unnamed plus-one slots by default; the placeholder-count note tests
    // override this. The slots themselves never appear (the API excludes them),
    // only this count.
    placeholder_count: 0,
    // Placeholder guests never appear: the API excludes them server-side, so
    // the page only ever receives the party's known people.
    guests: [
      {
        id: "g1",
        full_name: "Alice Smith",
        is_primary: true,
        is_child: false,
        email: "alice@example.com",
        phone: undefined,
        subscribed: true,
      },
      {
        id: "g2",
        full_name: "Bob Smith",
        is_primary: false,
        is_child: false,
        email: undefined,
        phone: undefined,
        subscribed: true,
      },
    ],
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/i/tok-123"]}>
        <Routes>
          <Route element={<InfoCollection />} path="/i/:token" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The section (card) for one guest, located by its accessible name. */
function guestSection(name: string) {
  return within(screen.getByRole("region", { name }));
}

/** The body of the PUT submitted to the API, from the mock's calls. */
function submittedPayload(): UpdatePartyInfoPayload {
  const putCall = apiRequest.mock.calls.find(
    (call) => (call[1] as { method?: string } | undefined)?.method === "PUT",
  );
  expect(putCall).toBeDefined();
  return (putCall![1] as { body: UpdatePartyInfoPayload }).body;
}

describe("InfoCollection", () => {
  beforeEach(() => {
    apiRequest.mockReset();
  });

  it("greets the primary guest by first name and pre-fills every guest's details", async () => {
    apiRequest.mockResolvedValue(makeData());
    renderPage();

    // Only the primary's first name: a full member list gets unwieldy for big
    // parties (the cards below name everyone).
    expect(
      await screen.findByRole("heading", { name: "Hi Alice!" }),
    ).toBeInTheDocument();
    expect(apiRequest).toHaveBeenCalledWith("/info/tok-123");
    expect(screen.queryByText("Primary contact")).not.toBeInTheDocument();

    // Pre-filled, editable name and contact fields.
    const alice = guestSection("Alice Smith");
    expect(alice.getByLabelText(/^Name/)).toHaveValue("Alice Smith");
    expect(alice.getByLabelText(/^Email/)).toHaveValue("alice@example.com");
    expect(alice.getByLabelText(/^Phone/)).toHaveValue("");
    expect(guestSection("Bob Smith").getByLabelText(/^Name/)).toHaveValue(
      "Bob Smith",
    );
  });

  it("titles the tab with the primary guest's first name, mirroring the link preview", async () => {
    apiRequest.mockResolvedValue(makeData());
    renderPage();
    await screen.findByRole("heading", { name: "Hi Alice!" });

    // First name made possessive (not the full name, and not the generic
    // fallback): the same format the server injects into the link-preview card.
    await waitFor(() =>
      expect(document.title).toBe("Alice's Info · Robin & Madeline"),
    );
  });

  it("falls back to the generic tab title when no primary guest is flagged", async () => {
    apiRequest.mockResolvedValue(
      makeData({
        guests: [
          {
            id: "g1",
            full_name: "Bob Smith",
            is_primary: false,
            is_child: false,
            email: undefined,
            phone: undefined,
            subscribed: true,
          },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    await waitFor(() =>
      expect(document.title).toBe("Your Details · Robin & Madeline"),
    );
  });

  it("invites the party to flag anyone we missed", async () => {
    apiRequest.mockResolvedValue(makeData());
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    expect(
      screen.getByText(/additional people in your party/i),
    ).toBeInTheDocument();
  });

  it("tells a solo-looking party how many more guests they'll name at RSVP", async () => {
    // One named guest plus a single unnamed plus-one slot: without the note the
    // page would look like a solo invitation. The slot itself stays hidden; only
    // the count surfaces, in the singular.
    apiRequest.mockResolvedValue(
      makeData({
        placeholder_count: 1,
        guests: [
          {
            id: "g1",
            full_name: "Alice Smith",
            is_primary: true,
            is_child: false,
            email: "alice@example.com",
            phone: undefined,
            subscribed: true,
          },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // The folded-in "flag anyone we missed" invite shares the same note, so the
    // singular branch carries it too (mirrors the plural assertion below).
    expect(
      screen.getByText(
        /your party also includes 1 additional guest you'll be able to name when rsvps open\. if we've missed anyone else, message us so we can add them/i,
      ),
    ).toBeInTheDocument();
  });

  it("counts multiple unnamed slots in the plural and folds in the flag-anyone-missed invite", async () => {
    // Two is the smallest plural, so it also pins the singular/plural boundary.
    apiRequest.mockResolvedValue(makeData({ placeholder_count: 2 }));
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // The count and the "flag anyone we missed" invitation share one combined
    // note, so a single element carries both.
    expect(
      screen.getByText(
        /your party also includes 2 additional guests you'll be able to name when rsvps open\. if we've missed anyone else, message us so we can add them/i,
      ),
    ).toBeInTheDocument();
  });

  it("shows no additional-guest note when the party has no unnamed slots", async () => {
    // makeData defaults to placeholder_count: 0.
    apiRequest.mockResolvedValue(makeData());
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    expect(
      screen.queryByText(/additional guests? you'll be able to name/i),
    ).not.toBeInTheDocument();
  });

  it("offers an email opt-in per emailed guest and drops the old opt-out note", async () => {
    apiRequest.mockResolvedValue(makeData());
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // The old "leave the email blank to opt out" disclaimer is gone, replaced
    // by the reassurance and a per-guest checkbox (ADR 0009).
    expect(
      screen.queryByText(/leave their email blank/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("We only send the occasional update."),
    ).toBeInTheDocument();

    // The opt-in shows (checked) for the guest with an email, and not at all
    // for the guest without one.
    expect(
      screen.getByRole("checkbox", {
        name: /Send Alice wedding updates by email/i,
      }),
    ).toBeChecked();
    expect(
      screen.queryByRole("checkbox", {
        name: /Send Bob wedding updates by email/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("submits the unchecked opt-in as unsubscribed", async () => {
    const user = userEvent.setup();
    // A digital party needs no address, so the submit is just the guest cards.
    apiRequest.mockResolvedValue(makeData({ invitation_type: "digital" }));
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    await user.click(
      screen.getByRole("checkbox", {
        name: /Send Alice wedding updates by email/i,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save your info" }));
    await screen.findByRole("heading", { name: "Thank you!" });

    const alice = submittedPayload().guests.find((g) => g.guest_id === "g1");
    expect(alice?.subscribed).toBe(false);
  });

  it("shows example placeholders in the empty fields", async () => {
    apiRequest.mockResolvedValue(makeData());
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    const alice = guestSection("Alice Smith");
    expect(alice.getByLabelText(/^Name/)).toHaveAttribute(
      "placeholder",
      "Jane Smith",
    );
    expect(alice.getByLabelText(/^Email/)).toHaveAttribute(
      "placeholder",
      "example@gmail.com",
    );
    expect(alice.getByLabelText(/^Phone/)).toHaveAttribute(
      "placeholder",
      "9725551234",
    );
    const address = within(screen.getByRole("region", { name: /address/i }));
    expect(address.getByLabelText(/Address line 1/)).toHaveAttribute(
      "placeholder",
      "123 Main St",
    );
    expect(address.getByLabelText(/ZIP code/)).toHaveAttribute(
      "placeholder",
      "75201",
    );
  });

  it("shows a saved phone number in the formatted style on revisit", async () => {
    apiRequest.mockResolvedValue(
      makeData({
        guests: [
          {
            id: "g1",
            full_name: "Alice Smith",
            is_primary: true,
            is_child: false,
            email: "alice@example.com",
            phone: "+19723121234",
            subscribed: true,
          },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // The backend stores E.164; the form regroups it instead of showing +1...
    expect(guestSection("Alice Smith").getByLabelText(/^Phone/)).toHaveValue(
      "(972) 312-1234",
    );
  });

  it("hides the email and phone fields for a child guest", async () => {
    const user = userEvent.setup();
    // Bob is a child: a child has no contact details of their own, so the form
    // drops both fields for him while keeping them for the adult primary.
    apiRequest.mockResolvedValue(
      makeData({
        invitation_type: "digital",
        guests: [
          {
            id: "g1",
            full_name: "Alice Smith",
            is_primary: true,
            is_child: false,
            email: "alice@example.com",
            phone: undefined,
            subscribed: true,
          },
          {
            id: "g2",
            full_name: "Bob Smith",
            is_primary: false,
            is_child: true,
            // An admin already entered contact details for this child; hiding
            // the fields must not wipe them on save.
            email: "bob@example.com",
            phone: "+19723121234",
            subscribed: false,
          },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // The adult keeps name, email, and phone.
    const alice = guestSection("Alice Smith");
    expect(alice.getByLabelText(/^Name/)).toBeInTheDocument();
    expect(alice.getByLabelText(/^Email/)).toBeInTheDocument();
    expect(alice.getByLabelText(/^Phone/)).toBeInTheDocument();

    // The child keeps an editable name but loses the contact fields entirely.
    const bob = guestSection("Bob Smith");
    expect(bob.getByLabelText(/^Name/)).toBeInTheDocument();
    expect(bob.queryByLabelText(/^Email/)).not.toBeInTheDocument();
    expect(bob.queryByLabelText(/^Phone/)).not.toBeInTheDocument();

    // Submitting still sends the child full-state, so the admin-entered values
    // (email, the stored phone, and the subscription) ride along untouched
    // rather than being silently dropped.
    await user.click(screen.getByRole("button", { name: "Save your info" }));
    await screen.findByRole("heading", { name: "Thank you!" });

    const bobPayload = submittedPayload().guests.find(
      (g) => g.guest_id === "g2",
    );
    expect(bobPayload).toEqual({
      guest_id: "g2",
      full_name: "Bob Smith",
      email: "bob@example.com",
      // Seeded from the stored E.164 and re-sent in the displayed format.
      phone: "(972) 312-1234",
      subscribed: false,
      remove: false,
    });
  });

  it("keeps the contact fields for a child flagged as the primary guest", async () => {
    // A child should never be the party's primary contact, but the two flags
    // are independent and nothing forbids the combination. The primary's email
    // is always required (the backend completion gate), so the contact fields
    // must stay visible even when the primary is flagged a child, or the form
    // can't be submitted.
    apiRequest.mockResolvedValue(
      makeData({
        invitation_type: "digital",
        guests: [
          {
            id: "g1",
            full_name: "Alice Smith",
            is_primary: true,
            is_child: true,
            email: "alice@example.com",
            phone: undefined,
            subscribed: true,
          },
        ],
      }),
    );
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    const alice = guestSection("Alice Smith");
    expect(alice.getByLabelText(/^Email/)).toBeRequired();
    expect(alice.getByLabelText(/^Phone/)).toBeInTheDocument();
  });

  it("requires the primary email and the address fields for a physical party", async () => {
    apiRequest.mockResolvedValue(makeData());
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // Every guest's name is required and carries the asterisk mark. The
    // primary's email is required and marked; another guest's email is
    // optional and unmarked.
    const alice = guestSection("Alice Smith");
    expect(alice.getByLabelText(/^Name/)).toBeRequired();
    expect(alice.getByLabelText(/^Email/)).toBeRequired();
    expect(alice.getAllByTitle("required")).toHaveLength(2);
    const bob = guestSection("Bob Smith");
    expect(bob.getByLabelText(/^Name/)).toBeRequired();
    expect(bob.getByLabelText(/^Email/)).not.toBeRequired();
    expect(bob.getAllByTitle("required")).toHaveLength(1);

    // A physical party's address section is present, with everything but
    // line 2 required.
    const address = within(screen.getByRole("region", { name: /address/i }));
    expect(address.getByLabelText(/Address line 1/)).toBeRequired();
    expect(address.getByLabelText(/Address line 2/)).not.toBeRequired();
    expect(address.getByLabelText(/City/)).toBeRequired();
    expect(address.getByLabelText(/State/)).toBeRequired();
    expect(address.getByLabelText(/ZIP code/)).toBeRequired();
    // This party is already set to the US, so the country field stays hidden
    // (it defaults to the US on submit).
    expect(address.queryByLabelText(/Country/)).not.toBeInTheDocument();
  });

  it("hides the address section for a digital party, with no note about it", async () => {
    apiRequest.mockResolvedValue(makeData({ invitation_type: "digital" }));
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // No address fields, and deliberately no explanation either: the page
    // never draws attention to a party not getting a physical invitation.
    expect(screen.queryByLabelText(/Address line 1/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /address/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/mailing address/i)).not.toBeInTheDocument();
  });

  it("submits corrections and shows the success confirmation", async () => {
    const user = userEvent.setup();
    apiRequest.mockImplementation(
      (_path: string, options?: { method?: string }) => {
        if (options?.method === "PUT") {
          return Promise.resolve(makeData());
        }
        return Promise.resolve(makeData());
      },
    );
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // Correct the primary's best-guess name and add a phone.
    const alice = guestSection("Alice Smith");
    await user.clear(alice.getByLabelText(/^Name/));
    await user.type(alice.getByLabelText(/^Name/), "Alicia Smith");
    await user.type(alice.getByLabelText(/^Phone/), "+14155552671");

    // Fill the required mailing address. A US party isn't asked for a country.
    const address = within(screen.getByRole("region", { name: /address/i }));
    await user.type(address.getByLabelText(/Address line 1/), "123 Main St");
    await user.type(address.getByLabelText(/City/), "Springfield");
    await user.type(address.getByLabelText(/State/), "IL");
    await user.type(address.getByLabelText(/ZIP code/), "62701");

    await user.click(screen.getByRole("button", { name: "Save your info" }));

    await screen.findByRole("heading", { name: "Thank you!" });

    const payload = submittedPayload();
    expect(payload.address_line_1).toBe("123 Main St");
    expect(payload.city).toBe("Springfield");
    // Country defaults to the US even though the guest never enters it.
    expect(payload.country).toBe("United States");
    expect(payload.guests).toEqual([
      {
        guest_id: "g1",
        full_name: "Alicia Smith",
        email: "alice@example.com",
        phone: "+1 415 555 2671",
        subscribed: true,
        remove: false,
      },
      {
        // An untouched prefilled name is sent back as-is (a no-op correction).
        // subscribed rides along full-state even though Bob has no email field.
        guest_id: "g2",
        full_name: "Bob Smith",
        email: "",
        phone: "",
        subscribed: true,
        remove: false,
      },
    ]);

    // The link stays useful: "Make changes" returns to the (refreshed) form.
    await user.click(screen.getByRole("button", { name: "Make changes" }));
    expect(
      await screen.findByRole("heading", { name: /^Hi / }),
    ).toBeInTheDocument();
  });

  it("shows the country field pre-filled for a party set to a non-US country", async () => {
    const user = userEvent.setup();
    apiRequest.mockResolvedValue(makeData({ country: "Canada" }));
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // A non-US country isn't hidden: the field shows, pre-filled and required,
    // so the guest can confirm or correct where they live.
    const address = within(screen.getByRole("region", { name: /address/i }));
    expect(address.getByLabelText(/Country/)).toHaveValue("Canada");
    expect(address.getByLabelText(/Country/)).toBeRequired();
    // Postal code isn't required abroad (many countries have none), though this
    // guest happens to have one.
    expect(address.getByLabelText(/Postal code/)).not.toBeRequired();

    await user.type(address.getByLabelText(/Address line 1/), "123 King St");
    await user.type(address.getByLabelText(/City/), "Toronto");
    // The US-format labels broaden for a non-US address.
    await user.type(address.getByLabelText(/State \/ Province/), "ON");
    await user.type(address.getByLabelText(/Postal code/), "M5H 2N2");

    await user.click(screen.getByRole("button", { name: "Save your info" }));
    await screen.findByRole("heading", { name: "Thank you!" });

    // The pre-filled country rides along untouched.
    expect(submittedPayload().country).toBe("Canada");
  });

  it("asks for the country and broadens the labels when the party isn't set to the US", async () => {
    const user = userEvent.setup();
    // No country on the party yet: we can't assume a US address, so the country
    // field appears (empty and required) and the US-format labels broaden.
    apiRequest.mockResolvedValue(makeData({ country: undefined }));
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    const address = within(screen.getByRole("region", { name: /address/i }));
    const countryField = address.getByLabelText(/Country/);
    expect(countryField).toHaveValue("");
    expect(countryField).toBeRequired();

    // "State" → "State / Province" and "ZIP code" → "Postal code".
    expect(address.getByLabelText(/State \/ Province/)).toBeInTheDocument();
    expect(address.getByLabelText(/Postal code/)).toBeInTheDocument();
    expect(address.queryByLabelText(/ZIP code/)).not.toBeInTheDocument();
    // And the postal code is optional, since we don't know the country has one.
    expect(address.getByLabelText(/Postal code/)).not.toBeRequired();

    await user.type(address.getByLabelText(/Address line 1/), "10 Downing St");
    await user.type(address.getByLabelText(/City/), "London");
    await user.type(
      address.getByLabelText(/State \/ Province/),
      "Greater London",
    );
    await user.type(address.getByLabelText(/Postal code/), "SW1A 2AA");
    await user.type(countryField, "United Kingdom");

    await user.click(screen.getByRole("button", { name: "Save your info" }));
    await screen.findByRole("heading", { name: "Thank you!" });

    // The typed country is sent instead of the US default.
    expect(submittedPayload().country).toBe("United Kingdom");
  });

  it("requires the postal code again if the guest enters the US as their country", async () => {
    const user = userEvent.setup();
    // The country starts unknown, so the postal code starts optional.
    apiRequest.mockResolvedValue(makeData({ country: undefined }));
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    const address = within(screen.getByRole("region", { name: /address/i }));
    expect(address.getByLabelText(/Postal code/)).not.toBeRequired();

    // Typing the US as the country makes the postal code required, matching the
    // backend gate, so the requirement can't slip through as a confusing 422.
    // Lowercased, to pin the case-insensitive match (the backend uses EqualFold).
    await user.type(address.getByLabelText(/Country/), "united states");
    expect(address.getByLabelText(/Postal code/)).toBeRequired();
  });

  it("submits an international address without a postal code", async () => {
    const user = userEvent.setup();
    // Postal code is optional abroad, so the guest can leave it blank and still
    // save (many countries have none).
    apiRequest.mockResolvedValue(makeData({ country: "Australia" }));
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    const address = within(screen.getByRole("region", { name: /address/i }));
    await user.type(address.getByLabelText(/Address line 1/), "1 Macquarie St");
    await user.type(address.getByLabelText(/City/), "Sydney");
    await user.type(address.getByLabelText(/State \/ Province/), "NSW");
    // Postal code deliberately left blank.

    await user.click(screen.getByRole("button", { name: "Save your info" }));
    await screen.findByRole("heading", { name: "Thank you!" });

    // The submit goes through with an empty postal code and the pre-filled
    // country, exactly the behavior the US-only requirement is meant to allow.
    const payload = submittedPayload();
    expect(payload.postal_code).toBe("");
    expect(payload.country).toBe("Australia");
  });

  it("removes a non-primary guest after an inline confirmation", async () => {
    const user = userEvent.setup();
    apiRequest.mockResolvedValue(makeData({ invitation_type: "digital" }));
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // The primary has no remove action.
    expect(
      guestSection("Alice Smith").queryByRole("button", {
        name: "No longer part of your party?",
      }),
    ).not.toBeInTheDocument();

    // Removing Bob asks for confirmation first; cancel keeps him.
    const bob = guestSection("Bob Smith");
    await user.click(
      bob.getByRole("button", { name: "No longer part of your party?" }),
    );
    await user.click(bob.getByRole("button", { name: "Cancel" }));
    expect(bob.getByLabelText(/^Name/)).toBeInTheDocument();

    // Confirming marks him for removal (applied on save) with an undo.
    await user.click(
      bob.getByRole("button", { name: "No longer part of your party?" }),
    );
    await user.click(bob.getByRole("button", { name: "Yes, remove" }));
    expect(bob.queryByLabelText(/^Name/)).not.toBeInTheDocument();
    expect(bob.getByText(/will be removed/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save your info" }));
    await screen.findByRole("heading", { name: "Thank you!" });

    const payload = submittedPayload();
    expect(payload.guests).toContainEqual({ guest_id: "g2", remove: true });
    expect(payload.address_line_1).toBeUndefined();
    // A digital party omits country too, so an admin-entered country is left
    // untouched (the default only applies on the physical path).
    expect(payload.country).toBeUndefined();
  });

  it("undo restores a guest marked for removal", async () => {
    const user = userEvent.setup();
    apiRequest.mockResolvedValue(makeData({ invitation_type: "digital" }));
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    const bob = guestSection("Bob Smith");
    await user.click(
      bob.getByRole("button", { name: "No longer part of your party?" }),
    );
    await user.click(bob.getByRole("button", { name: "Yes, remove" }));
    await user.click(bob.getByRole("button", { name: "Undo" }));
    expect(bob.getByLabelText(/^Name/)).toHaveValue("Bob Smith");
  });

  it("shows the submit error when the backend rejects the form", async () => {
    const user = userEvent.setup();
    apiRequest.mockImplementation(
      (_path: string, options?: { method?: string }) => {
        if (options?.method === "PUT") {
          return Promise.reject(
            new ApiError(
              422,
              "Required contact details are missing; please fill in every required field.",
              "validation_error",
            ),
          );
        }
        return Promise.resolve(makeData({ invitation_type: "digital" }));
      },
    );
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    await user.click(screen.getByRole("button", { name: "Save your info" }));
    expect(
      await screen.findByText(/Required contact details are missing/),
    ).toBeInTheDocument();
  });

  it("shows the invalid-link message for an unknown token", async () => {
    apiRequest.mockRejectedValue(new ApiError(404, "party not found"));
    renderPage();

    await waitFor(() => {
      expect(screen.getByText(/link isn't valid/i)).toBeInTheDocument();
    });
  });
});
