import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SendResponse } from "@/types/generated/emails";

import AdminEmails from "./AdminEmails";

// adminRequest is the single network seam; the tests drive the UI by stubbing
// its responses.
const adminRequest = vi.fn();
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: (...args: unknown[]) => adminRequest(...args),
  };
});

function makeSend(overrides: Partial<SendResponse>): SendResponse {
  return {
    id: "s1",
    template_id: undefined,
    subject: "Save the date!",
    body: "Body",
    recipient_filter: {},
    sent_at: "2026-06-01T18:00:00Z",
    sent_by: "admin",
    is_test: false,
    created_at: "2026-06-01T18:00:00Z",
    updated_at: "2026-06-01T18:00:00Z",
    stats: {
      queued: 0,
      sending: 0,
      sent: 1,
      delivered: 2,
      bounced: 1,
      failed: 0,
      total: 4,
    },
    ...overrides,
  };
}

function renderEmails() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminEmails />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminEmails history", () => {
  it("renders each send with its delivery stats and a detail link", async () => {
    adminRequest.mockResolvedValue({
      items: [makeSend({ id: "s1" })],
      total: 1,
    });

    renderEmails();

    const subject = await screen.findByRole("link", {
      name: "Save the date!",
    });
    expect(subject).toHaveAttribute("href", "/admin/emails/sends/s1");
    // The stats summary lists only the statuses that occur, plus the total.
    expect(
      screen.getByText(/1 sent, 2 delivered, 1 bounced/),
    ).toBeInTheDocument();
    expect(screen.getByText(/of 4 recipients/)).toBeInTheDocument();
  });

  it("shows the empty state before anything has been sent", async () => {
    adminRequest.mockResolvedValue({ items: [], total: 0 });

    renderEmails();

    expect(await screen.findByText(/Nothing sent yet/)).toBeInTheDocument();
    // Compose and template management are reachable from here.
    expect(screen.getByRole("link", { name: /Compose/ })).toHaveAttribute(
      "href",
      "/admin/emails/compose",
    );
    expect(screen.getByRole("link", { name: "Templates" })).toHaveAttribute(
      "href",
      "/admin/emails/templates",
    );
  });
});

describe("AdminEmails test sends", () => {
  it("badges a test send and leaves real sends unbadged", async () => {
    adminRequest.mockResolvedValue({
      items: [
        makeSend({ id: "real", subject: "Real send", is_test: false }),
        makeSend({ id: "test", subject: "Test send", is_test: true }),
      ],
      total: 2,
    });

    renderEmails();

    // The test send's row carries a Test badge; the real send's does not.
    const testRow = await screen.findByRole("row", { name: /Test send/ });
    expect(within(testRow).getByText("Test")).toBeInTheDocument();
    const realRow = screen.getByRole("row", { name: /Real send/ });
    expect(within(realRow).queryByText("Test")).not.toBeInTheDocument();
  });

  it("filters the list to real or test sends", async () => {
    adminRequest.mockResolvedValue({
      items: [
        makeSend({ id: "real", subject: "Real send", is_test: false }),
        makeSend({ id: "test", subject: "Test send", is_test: true }),
      ],
      total: 2,
    });
    const user = userEvent.setup();
    renderEmails();

    // All by default: both rows present.
    expect(
      await screen.findByRole("link", { name: "Real send" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Test send" })).toBeInTheDocument();

    // Tests: only the test send.
    await user.click(screen.getByRole("button", { name: "Tests" }));
    expect(screen.getByRole("link", { name: "Test send" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Real send" }),
    ).not.toBeInTheDocument();

    // Real: only the real send.
    await user.click(screen.getByRole("button", { name: "Real" }));
    expect(screen.getByRole("link", { name: "Real send" })).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Test send" }),
    ).not.toBeInTheDocument();
  });
});
