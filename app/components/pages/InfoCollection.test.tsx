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
    guests: [
      {
        id: "g1",
        full_name: "Alice Smith",
        is_primary: true,
        placeholder_text: undefined,
        email: "alice@example.com",
        phone: undefined,
      },
      {
        id: "g2",
        full_name: "Bob Smith",
        is_primary: false,
        placeholder_text: undefined,
        email: undefined,
        phone: undefined,
      },
      {
        // An unnamed placeholder: full_name still equals the descriptor.
        id: "g3",
        full_name: "Guest of Alice",
        is_primary: false,
        placeholder_text: "Guest of Alice",
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

    // An unnamed placeholder keeps its descriptor as the heading and starts
    // with a blank name field.
    const placeholder = guestSection("Guest of Alice");
    expect(placeholder.getByLabelText(/^Name/)).toHaveValue("");
  });

  it("requires the primary email and the address fields for a physical party", async () => {
    apiRequest.mockResolvedValue(makeData());
    renderPage();
    await screen.findByRole("heading", { name: /^Hi / });

    // The primary's email is required and marked with an asterisk that
    // explains itself on hover; another guest's is optional and unmarked.
    const alice = guestSection("Alice Smith");
    expect(alice.getByLabelText(/^Email/)).toBeRequired();
    expect(alice.getByTitle("required")).toHaveTextContent("*");
    const bob = guestSection("Bob Smith");
    expect(bob.getByLabelText(/^Email/)).not.toBeRequired();
    expect(bob.queryByTitle("required")).not.toBeInTheDocument();

    // A physical party's address section is present, with everything but
    // line 2 required.
    const address = within(screen.getByRole("region", { name: /address/i }));
    expect(address.getByLabelText(/Address line 1/)).toBeRequired();
    expect(address.getByLabelText(/Address line 2/)).not.toBeRequired();
    expect(address.getByLabelText(/City/)).toBeRequired();
    expect(address.getByLabelText(/State or province/)).toBeRequired();
    expect(address.getByLabelText(/Postal code/)).toBeRequired();
    expect(address.getByLabelText(/Country/)).toBeRequired();
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

    // Correct the primary's best-guess name and add a phone; name the
    // placeholder slot.
    const alice = guestSection("Alice Smith");
    await user.clear(alice.getByLabelText(/^Name/));
    await user.type(alice.getByLabelText(/^Name/), "Alicia Smith");
    await user.type(alice.getByLabelText(/^Phone/), "+14155552671");
    await user.type(
      guestSection("Guest of Alice").getByLabelText(/^Name/),
      "Dana Lee",
    );

    // Fill the required mailing address.
    const address = within(screen.getByRole("region", { name: /address/i }));
    await user.type(address.getByLabelText(/Address line 1/), "123 Main St");
    await user.type(address.getByLabelText(/City/), "Springfield");
    await user.type(address.getByLabelText(/State or province/), "IL");
    await user.type(address.getByLabelText(/Postal code/), "62701");
    await user.type(address.getByLabelText(/Country/), "USA");

    await user.click(screen.getByRole("button", { name: "Save your info" }));

    await screen.findByRole("heading", { name: "Thank you!" });

    const payload = submittedPayload();
    expect(payload.address_line_1).toBe("123 Main St");
    expect(payload.city).toBe("Springfield");
    expect(payload.guests).toEqual([
      {
        guest_id: "g1",
        full_name: "Alicia Smith",
        email: "alice@example.com",
        phone: "+14155552671",
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
      {
        guest_id: "g3",
        full_name: "Dana Lee",
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
