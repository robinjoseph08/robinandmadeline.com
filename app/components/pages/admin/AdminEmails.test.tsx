import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

describe("AdminEmails live polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // A send with a recipient still in flight (queued or sending).
  const inFlight = {
    queued: 1,
    sending: 1,
    sent: 0,
    delivered: 0,
    bounced: 0,
    failed: 0,
    total: 2,
  };
  // A send where everything has been dispatched.
  const settled = {
    queued: 0,
    sending: 0,
    sent: 0,
    delivered: 1,
    bounced: 1,
    failed: 0,
    total: 2,
  };

  it("refetches every 5s while any send is in flight, then stops once all settle", async () => {
    // The history polls while any listed send still has queued or sending
    // recipients, so statuses progress without a manual refresh; once every
    // send has settled the poll must stop rather than refetch forever.
    adminRequest.mockResolvedValue({
      items: [makeSend({ id: "s1", stats: inFlight })],
      total: 1,
    });

    renderEmails();

    // Flush the mount fetch: its in-flight send schedules the 5s poll.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(adminRequest).toHaveBeenCalledTimes(1);

    // One interval later a second fetch fires (it would not if the predicate
    // were inverted, dropped `sending`, or returned a constant false).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(adminRequest).toHaveBeenCalledTimes(2);

    // Every send now reports settled, so the next poll's predicate is false.
    adminRequest.mockResolvedValue({
      items: [makeSend({ id: "s1", stats: settled })],
      total: 1,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(adminRequest).toHaveBeenCalledTimes(3);

    // Polling has stopped: no further fetch fires after another interval (it
    // would if the predicate returned a constant 5000 instead of false).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(adminRequest).toHaveBeenCalledTimes(3);
  });

  it("does not poll when every listed send is already settled", async () => {
    // All sends mount settled (no queued or sending recipients), so the history
    // must never start polling.
    adminRequest.mockResolvedValue({
      items: [makeSend({ id: "s1", stats: settled })],
      total: 1,
    });

    renderEmails();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(adminRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(adminRequest).toHaveBeenCalledTimes(1);
  });
});
