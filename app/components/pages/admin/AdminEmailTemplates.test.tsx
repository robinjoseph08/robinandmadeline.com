import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { TemplateResponse } from "@/types/generated/emails";

import AdminEmailTemplates from "./AdminEmailTemplates";

// adminRequest is the single network seam; the tests drive the UI by stubbing
// its responses per call and assert on the requests it receives.
const adminRequest = vi.fn();
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: (...args: unknown[]) => adminRequest(...args),
  };
});

function makeTemplate(overrides: Partial<TemplateResponse>): TemplateResponse {
  return {
    id: "t1",
    name: "Save the date",
    subject: "Save the date, {{guest_name}}!",
    body: "Hi {{guest_name}}, we're getting married!",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderTemplates() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <TooltipProvider>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminEmailTemplates />
        </MemoryRouter>
      </QueryClientProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminEmailTemplates list", () => {
  it("renders each template's name and subject", async () => {
    adminRequest.mockResolvedValue({
      items: [
        makeTemplate({ id: "t1", name: "Save the date" }),
        makeTemplate({
          id: "t2",
          name: "RSVP reminder",
          subject: "Don't forget to RSVP",
        }),
      ],
      total: 2,
    });

    renderTemplates();

    expect(await screen.findByText("Save the date")).toBeInTheDocument();
    expect(screen.getByText("RSVP reminder")).toBeInTheDocument();
    expect(screen.getByText("Don't forget to RSVP")).toBeInTheDocument();
    expect(screen.getByText("2 templates")).toBeInTheDocument();
  });
});

describe("AdminEmailTemplates create", () => {
  it("POSTs the dialog's payload and refreshes the list", async () => {
    adminRequest.mockImplementation((_path: string, options?: object) => {
      const method = (options as { method?: string } | undefined)?.method;
      if (method === "POST") {
        return Promise.resolve(makeTemplate({ id: "t-new" }));
      }
      return Promise.resolve({ items: [], total: 0 });
    });

    const user = userEvent.setup();
    renderTemplates();

    await user.click(
      await screen.findByRole("button", { name: /Add template/ }),
    );
    // Plain text only: userEvent.type treats braces as key descriptors, and
    // merge-field rendering is covered by backend tests anyway.
    await user.type(screen.getByLabelText("Name"), "Save the date");
    await user.type(screen.getByLabelText("Subject"), "Hello friends");
    await user.type(screen.getByLabelText("Body"), "We're getting married!");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/emails/templates", {
        method: "POST",
        body: {
          name: "Save the date",
          subject: "Hello friends",
          body: "We're getting married!",
        },
      });
    });
  });
});

describe("AdminEmailTemplates delete", () => {
  it("DELETEs after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    adminRequest.mockImplementation((_path: string, options?: object) => {
      const method = (options as { method?: string } | undefined)?.method;
      if (method === "DELETE") return Promise.resolve(undefined);
      return Promise.resolve({
        items: [makeTemplate({ id: "t1", name: "Save the date" })],
        total: 1,
      });
    });

    const user = userEvent.setup();
    renderTemplates();

    await user.click(
      await screen.findByRole("button", { name: "Delete Save the date" }),
    );

    await waitFor(() => {
      expect(adminRequest).toHaveBeenCalledWith("/admin/emails/templates/t1", {
        method: "DELETE",
      });
    });
  });
});
