import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Response as SettingsResponse } from "@/types/generated/settings";

import AdminSettings from "./AdminSettings";

// adminRequest is the single network seam; the tests drive the UI by stubbing
// the settings GET and PUT.
const adminRequest = vi.fn();
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: (...args: unknown[]) => adminRequest(...args),
  };
});

// toast is asserted on for the save-confirmation and error paths.
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

function makeSettings(
  overrides: Partial<SettingsResponse> = {},
): SettingsResponse {
  return { rsvp_deadline: undefined, contact_email: undefined, ...overrides };
}

// stub routes adminRequest by method: settings GET and settings PUT.
function stub(options: {
  settings?: SettingsResponse;
  onPut?: (body: unknown) => SettingsResponse;
}) {
  adminRequest.mockImplementation(
    (path: string, opts?: { method?: string; body?: unknown }) => {
      if (
        path === "/admin/settings" &&
        (!opts || opts.method === undefined || opts.method === "GET")
      ) {
        return Promise.resolve(options.settings ?? makeSettings());
      }
      if (path === "/admin/settings" && opts?.method === "PUT") {
        const result = options.onPut?.(opts.body) ?? makeSettings();
        return Promise.resolve(result);
      }
      return Promise.reject(new Error(`unexpected path ${path}`));
    },
  );
}

function renderSettings() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminSettings />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

describe("AdminSettings", () => {
  it("seeds the deadline and contact email from the fetched settings", async () => {
    stub({
      settings: makeSettings({
        rsvp_deadline: "2026-08-01T23:59:59Z",
        contact_email: "hello@example.com",
      }),
    });
    renderSettings();

    const deadline = await screen.findByLabelText("RSVP deadline");
    // The RFC3339 deadline shows as its date in the picker.
    await waitFor(() => expect(deadline).toHaveValue("2026-08-01"));
    expect(screen.getByLabelText("Contact email")).toHaveValue(
      "hello@example.com",
    );
  });

  it("saves the deadline as an end-of-day timestamp and the contact email", async () => {
    let putBody: unknown;
    stub({
      settings: makeSettings(),
      onPut: (body) => {
        putBody = body;
        return makeSettings({
          rsvp_deadline: "2026-09-15T23:59:59Z",
          contact_email: "us@example.com",
        });
      },
    });
    const user = userEvent.setup();
    renderSettings();

    const deadline = await screen.findByLabelText("RSVP deadline");
    await user.clear(deadline);
    await user.type(deadline, "2026-09-15");
    const email = screen.getByLabelText("Contact email");
    await user.clear(email);
    await user.type(email, "us@example.com");

    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Settings saved"),
    );
    // The picked date is persisted as the end of that UTC day; the contact
    // email is sent trimmed.
    expect(putBody).toEqual({
      rsvp_deadline: "2026-09-15T23:59:59Z",
      contact_email: "us@example.com",
    });
  });

  it("clears the deadline by sending an empty string when the date is cleared", async () => {
    let putBody: unknown;
    stub({
      settings: makeSettings({ rsvp_deadline: "2026-08-01T23:59:59Z" }),
      onPut: (body) => {
        putBody = body;
        return makeSettings();
      },
    });
    const user = userEvent.setup();
    renderSettings();

    const deadline = await screen.findByLabelText("RSVP deadline");
    await waitFor(() => expect(deadline).toHaveValue("2026-08-01"));
    await user.clear(deadline);

    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(putBody).toMatchObject({ rsvp_deadline: "" });
  });

  it("surfaces a save error in a toast", async () => {
    adminRequest.mockImplementation(
      (path: string, opts?: { method?: string }) => {
        if (path === "/admin/settings" && opts?.method === "PUT") {
          return Promise.reject(
            new Error("Contact email must be a valid email address."),
          );
        }
        return Promise.resolve(makeSettings());
      },
    );
    const user = userEvent.setup();
    renderSettings();

    await screen.findByLabelText("Contact email");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Contact email must be a valid email address.",
      ),
    );
  });
});
