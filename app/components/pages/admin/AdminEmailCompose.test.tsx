import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { PreviewEmailResponse } from "@/types/generated/emails";

import AdminEmailCompose from "./AdminEmailCompose";

// adminRequest is the single network seam; the tests drive the UI by stubbing
// its responses per path and assert on the requests it receives.
const adminRequest = vi.fn();
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: (...args: unknown[]) => adminRequest(...args),
  };
});

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual =
    await vi.importActual<typeof import("react-router-dom")>(
      "react-router-dom",
    );
  return { ...actual, useNavigate: () => navigate };
});

function makePreview(
  overrides: Partial<PreviewEmailResponse>,
): PreviewEmailResponse {
  return {
    recipients: [
      {
        guest_id: "g1",
        guest_name: "Alice",
        email_address: "alice@example.com",
        party_name: "The Smiths",
      },
    ],
    total: 1,
    skipped_no_email: 0,
    sample_guest_name: "Alice",
    sample_subject: "Hi Alice",
    sample_body: "Welcome, The Smiths!",
    ...overrides,
  };
}

interface MockOptions {
  preview?: PreviewEmailResponse;
  templates?: object[];
}

function setMock(opts: MockOptions = {}) {
  adminRequest.mockImplementation((path: string) => {
    if (path === "/admin/emails/templates") {
      return Promise.resolve({
        items: opts.templates ?? [],
        total: opts.templates?.length ?? 0,
      });
    }
    if (path === "/admin/events") {
      return Promise.resolve({ items: [], total: 0 });
    }
    if (path === "/admin/emails/preview") {
      return Promise.resolve(opts.preview ?? makePreview({}));
    }
    if (path === "/admin/emails/send") {
      return Promise.resolve({
        id: "send-1",
        subject: "s",
        stats: { total: 1, queued: 1 },
      });
    }
    return Promise.resolve({ items: [], total: 0 });
  });
}

function renderCompose() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminEmailCompose />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  // Restore the window.confirm spies individual tests install, so a previous
  // test's stub never leaks into the next.
  vi.restoreAllMocks();
  adminRequest.mockReset();
  navigate.mockReset();
});

describe("AdminEmailCompose preview", () => {
  it("POSTs the composed email with the chosen filters and shows the resolved sample", async () => {
    setMock();
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello there");
    await user.type(screen.getByLabelText("Body"), "Big news!");

    // Narrow the audience to Robin's side via the filter select.
    await user.click(screen.getByRole("combobox", { name: "Side" }));
    await user.click(await screen.findByRole("option", { name: "Robin" }));

    await user.click(screen.getByRole("button", { name: "Preview" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/emails/preview", {
        method: "POST",
        body: {
          subject: "Hello there",
          body: "Big news!",
          filter: { side: "robin" },
        },
      });
    });

    // The preview panel shows the sample resolved for the first recipient and
    // the recipient list.
    expect(await screen.findByText("Hi Alice")).toBeInTheDocument();
    expect(screen.getByText("Welcome, The Smiths!")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
    expect(screen.getByText("1 recipient")).toBeInTheDocument();
  });

  it("calls out matching guests skipped for having no email", async () => {
    setMock({ preview: makePreview({ skipped_no_email: 2 }) });
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(
      await screen.findByText(/2 matching guests skipped \(no email address\)/),
    ).toBeInTheDocument();
  });
});

describe("AdminEmailCompose send", () => {
  it("confirms with the live recipient count, POSTs the send, and navigates to its detail", async () => {
    setMock({ preview: makePreview({ total: 3 }) });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/emails/send", {
        method: "POST",
        body: {
          template_id: undefined,
          subject: "Hello",
          body: "Body",
          filter: {},
        },
      });
    });
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("3 recipients"),
    );
    expect(navigate).toHaveBeenCalledWith("/admin/emails/sends/send-1");
  });

  it("does not send when the confirmation is declined", async () => {
    setMock();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Send" }));

    // The pre-send preview ran, but no send was dispatched.
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/emails/preview",
        expect.anything(),
      );
    });
    expect(adminRequest).not.toHaveBeenCalledWith(
      "/admin/emails/send",
      expect.anything(),
    );
  });

  it("refuses to send to zero recipients", async () => {
    setMock({
      preview: makePreview({ total: 0, recipients: [], sample_subject: "" }),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith(
        "/admin/emails/preview",
        expect.anything(),
      );
    });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(adminRequest).not.toHaveBeenCalledWith(
      "/admin/emails/send",
      expect.anything(),
    );
  });
});

describe("AdminEmailCompose templates", () => {
  it("loads a template's subject and body and records its provenance on the send", async () => {
    setMock({
      templates: [
        {
          id: "tpl-1",
          name: "Save the date",
          subject: "Save the date!",
          body: "Mark your calendar.",
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderCompose();

    await user.click(screen.getByRole("combobox", { name: "Template" }));
    await user.click(
      await screen.findByRole("option", { name: "Save the date" }),
    );

    expect(screen.getByLabelText("Subject")).toHaveValue("Save the date!");
    expect(screen.getByLabelText("Body")).toHaveValue("Mark your calendar.");

    await user.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/emails/send", {
        method: "POST",
        body: {
          template_id: "tpl-1",
          subject: "Save the date!",
          body: "Mark your calendar.",
          filter: {},
        },
      });
    });
  });
});
