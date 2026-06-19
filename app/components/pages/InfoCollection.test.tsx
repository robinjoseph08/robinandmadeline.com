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
    country: undefined,
    // Placeholder guests never appear: the API excludes them server-side, so
    // the page only ever receives the party's known people.
    guests: [
      {
        id: "g1",
        full_name: "Alice Smith",
        is_primary: true,
        email: "alice@example.com",
        phone: undefined,
      },
      {
        id: "g2",
        full_name: "Bob Smith",
        is_primary: false,
        email: undefined,
        phone: undefined,
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

  it("invites the party to flag anyone we missed", async () => {
    apiRequest.mockResolvedValue(makeData());
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    expect(
      screen.getByText(/additional people in your party/i),
    ).toBeInTheDocument();
  });

  it("tells the party that submitted emails receive the rare updates", async () => {
    apiRequest.mockResolvedValue(makeData());
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // Pin both halves of the note: that submitted emails receive the updates,
    // and the opt-out (leave an email blank).
    expect(
      screen.getByText(/every email entered above gets a copy/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/leave their email blank/i)).toBeInTheDocument();
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
            email: "alice@example.com",
            phone: "+19723121234",
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
    // Country is no longer asked: it's hidden and defaults to the US on submit.
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

    // Fill the required mailing address. Country isn't asked on the form.
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
        remove: false,
      },
      {
        // An untouched prefilled name is sent back as-is (a no-op correction).
        guest_id: "g2",
        full_name: "Bob Smith",
        email: "",
        phone: "",
        remove: false,
      },
    ]);

    // The link stays useful: "Make changes" returns to the (refreshed) form.
    await user.click(screen.getByRole("button", { name: "Make changes" }));
    expect(
      await screen.findByRole("heading", { name: /^Hi / }),
    ).toBeInTheDocument();
  });

  it("keeps an admin-entered country instead of defaulting to the US", async () => {
    const user = userEvent.setup();
    apiRequest.mockResolvedValue(makeData({ country: "Canada" }));
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // The country field is hidden, but a non-US country an admin already set is
    // preserved rather than overwritten with the US default.
    const address = within(screen.getByRole("region", { name: /address/i }));
    await user.type(address.getByLabelText(/Address line 1/), "123 King St");
    await user.type(address.getByLabelText(/City/), "Toronto");
    await user.type(address.getByLabelText(/State/), "ON");
    await user.type(address.getByLabelText(/ZIP code/), "M5H 2N2");

    await user.click(screen.getByRole("button", { name: "Save your info" }));
    await screen.findByRole("heading", { name: "Thank you!" });

    expect(submittedPayload().country).toBe("Canada");
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
