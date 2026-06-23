import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SendDetailResponse } from "@/types/generated/emails";

import AdminEmailSendDetail from "./AdminEmailSendDetail";

// adminRequest is the single network seam; the tests drive the UI by stubbing
// its response.
const adminRequest = vi.fn();
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: (...args: unknown[]) => adminRequest(...args),
  };
});

function makeDetail(
  overrides: Partial<SendDetailResponse>,
): SendDetailResponse {
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
      delivered: 0,
      bounced: 0,
      failed: 0,
      unsubscribed: 0,
      total: 1,
    },
    recipients: [],
    ...overrides,
  };
}

function renderDetail() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/emails/sends/s1"]}>
        <Routes>
          <Route
            element={<AdminEmailSendDetail />}
            path="/admin/emails/sends/:id"
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  adminRequest.mockReset();
});

describe("AdminEmailSendDetail", () => {
  it("badges a test send near the heading", async () => {
    adminRequest.mockResolvedValue(makeDetail({ is_test: true }));

    renderDetail();

    expect(
      await screen.findByRole("heading", { name: "Save the date!" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Test send")).toBeInTheDocument();
  });

  it("shows no test badge for a real send", async () => {
    adminRequest.mockResolvedValue(makeDetail({ is_test: false }));

    renderDetail();

    expect(
      await screen.findByRole("heading", { name: "Save the date!" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Test send")).not.toBeInTheDocument();
  });
});

describe("AdminEmailSendDetail live polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // queued/sending stats with a recipient still in flight.
  const inFlight = {
    queued: 1,
    sending: 1,
    sent: 0,
    delivered: 0,
    bounced: 0,
    failed: 0,
    unsubscribed: 0,
    total: 2,
  };
  // Everything dispatched: nothing queued or sending.
  const settled = {
    queued: 0,
    sending: 0,
    sent: 0,
    delivered: 1,
    bounced: 1,
    failed: 0,
    unsubscribed: 0,
    total: 2,
  };

  it("refetches every 5s while a recipient is in flight, then stops once settled", async () => {
    // While anything is queued or sending, the detail polls so statuses
    // progress live; the moment the send settles (queued + sending === 0) the
    // poll must stop, or a finished send would refetch forever.
    adminRequest.mockResolvedValue(makeDetail({ stats: inFlight }));

    renderDetail();

    // Flush the mount fetch: its in-flight stats schedule the 5s poll.
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

    // The send now reports settled, so the next poll's predicate returns false.
    adminRequest.mockResolvedValue(makeDetail({ stats: settled }));
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

  it("does not poll a send that is already settled", async () => {
    // A settled send mounts with queued + sending === 0, so it must never start
    // polling at all.
    adminRequest.mockResolvedValue(makeDetail({ stats: settled }));

    renderDetail();

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
