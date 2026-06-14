import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { toast } from "sonner";
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
    skipped: [],
    sample_guest_name: "Alice",
    sample_subject: "Hi Alice",
    sample_body: "Welcome, friends!",
    sample_html: "<!doctype html><p>Welcome, friends!</p>",
    warnings: [],
    daily_send_limit: 100,
    daily_sends_used: 0,
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

    // The preview panel shows the resolved subject inline, the rendered HTML
    // email in a sandboxed iframe, and the recipient list.
    expect(await screen.findByText("Hi Alice")).toBeInTheDocument();
    const frame = screen.getByTitle(
      "Email preview for Alice",
    ) as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("Welcome, friends!");
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

  it("notes in the preview panel when the send will span multiple days", async () => {
    setMock({ preview: makePreview({ total: 250, daily_sends_used: 50 }) });
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText(/approximately 3 days/)).toBeInTheDocument();
  });

  it("clears the shown preview when the composed email changes", async () => {
    setMock();
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText("Hi Alice")).toBeInTheDocument();

    // Any edit invalidates the panel: what is shown must be what would send.
    await user.type(screen.getByLabelText("Subject"), "!");
    expect(screen.queryByText("Hi Alice")).not.toBeInTheDocument();
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

  it("ignores a second Send click while the first is still resolving", async () => {
    // The pre-send count re-resolve leaves a window before the send mutation
    // starts; a second click there must not start a second flow (it would
    // dispatch the whole bulk send twice). Hold the preview open to sit in
    // that window.
    let resolvePreview: ((v: PreviewEmailResponse) => void) | undefined;
    adminRequest.mockImplementation((path: string) => {
      if (path === "/admin/emails/preview") {
        return new Promise((res) => {
          resolvePreview = res;
        });
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
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    const send = screen.getByRole("button", { name: "Send" });
    await user.click(send);

    // Mid-re-resolve: the button is disabled, so this click is a no-op.
    expect(send).toBeDisabled();
    await user.click(send);

    resolvePreview!(makePreview({}));
    await waitFor(() => expect(navigate).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(
      adminRequest.mock.calls.filter(([path]) => path === "/admin/emails/send"),
    ).toHaveLength(1);
  });

  it("warns in the confirm dialog when the send exceeds today's daily budget", async () => {
    // 250 recipients against a limit of 100 with 50 already used: 50 go today,
    // 100 tomorrow, 100 the day after, so roughly 3 days.
    setMock({
      preview: makePreview({ total: 250, daily_sends_used: 50 }),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining("approximately 3 days"),
      );
    });
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining("daily send limit is 100 (50 used today)"),
    );
  });

  it("does not count today when its budget is already spent", async () => {
    // 100 recipients with the whole limit of 100 already used: nothing goes
    // out today, all 100 go out tomorrow, so the estimate is one day (not
    // two, which counting today would claim).
    setMock({
      preview: makePreview({ total: 100, daily_sends_used: 100 }),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining("approximately 1 day."),
      );
    });
  });

  it("does not mention multiple days when today's budget covers the send", async () => {
    setMock({ preview: makePreview({ total: 3 }) });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.not.stringContaining("approximately"),
    );
  });

  it("does not mention multiple days when the limit is unlimited", async () => {
    setMock({
      preview: makePreview({ total: 250, daily_send_limit: 0 }),
    });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.not.stringContaining("approximately"),
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

describe("AdminEmailCompose merge-field warnings", () => {
  it("shows a warning callout and disables Send when the preview warns", async () => {
    setMock({
      preview: makePreview({
        warnings: [
          {
            field: "event_name",
            message:
              "uses {{event_name}}/{{event_date}} but no event is selected in the recipient filter.",
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "About {{event_name}}");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    // The warning is surfaced near the preview...
    expect(
      await screen.findByText(/no event is selected in the recipient filter/),
    ).toBeInTheDocument();
    // ...and Send is disabled so a blank merge field can never be dispatched.
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("keeps Send enabled when the preview has no warnings", async () => {
    setMock({ preview: makePreview({}) });
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("Hi Alice")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeEnabled();
  });
});

describe("AdminEmailCompose recipient double-check", () => {
  it("lists the included recipients with a count and the skipped guests separately", async () => {
    setMock({
      preview: makePreview({
        total: 1,
        skipped_no_email: 1,
        skipped: [
          {
            guest_id: "g2",
            guest_name: "Bob No-Email",
            party_name: "The Joneses",
          },
        ],
      }),
    });
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Preview" }));

    // The included list is headed with its count, and the recipient is shown.
    expect(
      await screen.findByText("Included recipients (1)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();

    // The excluded guest is surfaced by name and party, not just a count, so the
    // admin can verify the exclusion.
    expect(
      screen.getByText("Skipped (no email address) (1)"),
    ).toBeInTheDocument();
    expect(screen.getByText("Bob No-Email")).toBeInTheDocument();
    expect(screen.getByText("The Joneses")).toBeInTheDocument();
  });
});

describe("AdminEmailCompose send test", () => {
  it("POSTs the draft to the test endpoint, toasts, and navigates to the send detail", async () => {
    setMock();
    adminRequest.mockImplementation((path: string) => {
      if (path === "/admin/emails/test") {
        return Promise.resolve({ send_id: "test-send-1", queued: 2 });
      }
      if (path === "/admin/emails/templates") {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.resolve({ items: [], total: 0 });
    });
    const successSpy = vi.spyOn(toast, "success");
    const user = userEvent.setup();
    renderCompose();

    await user.type(screen.getByLabelText("Subject"), "Hello");
    await user.type(screen.getByLabelText("Body"), "Body");
    await user.click(screen.getByRole("button", { name: "Send test" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/emails/test", {
        method: "POST",
        body: {
          template_id: undefined,
          subject: "Hello",
          body: "Body",
          filter: {},
        },
      });
    });
    // A test send is a real send now: it toasts and opens the send detail to
    // watch delivery, the same as a real send.
    expect(successSpy).toHaveBeenCalledWith(
      expect.stringContaining("Test queued"),
    );
    expect(navigate).toHaveBeenCalledWith("/admin/emails/sends/test-send-1");
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
