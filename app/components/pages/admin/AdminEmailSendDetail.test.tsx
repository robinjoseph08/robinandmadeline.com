import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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

// Renders the router state the compose page would receive, so a test can
// follow the Resend link and inspect the draft it hands over.
function ComposeStateProbe() {
  const location = useLocation();
  return (
    <pre data-testid="compose-state">{JSON.stringify(location.state)}</pre>
  );
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
          <Route element={<ComposeStateProbe />} path="/admin/emails/compose" />
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

  it("resends to one guest with the same copy and event", async () => {
    adminRequest.mockResolvedValue(
      makeDetail({
        template_id: "t1",
        recipient_filter: {
          event_ids: ["e1"],
          rsvp_statuses: ["pending"],
        },
        recipients: [
          {
            id: "r1",
            send_id: "s1",
            guest_id: "g1",
            guest_name: "Alice",
            party_name: "The Smiths",
            email_address: "alcie@example.com",
            status: "bounced",
            created_at: "2026-06-01T18:00:00Z",
            updated_at: "2026-06-01T18:00:00Z",
          },
        ],
      }),
    );
    const user = userEvent.setup();
    renderDetail();

    await user.click(
      await screen.findByRole("link", { name: "Resend to Alice" }),
    );

    // Only the guest and the merge-field event carry over: the rest of the
    // original filter (here, the RSVP status) no longer has to match.
    expect(
      JSON.parse(screen.getByTestId("compose-state").textContent ?? ""),
    ).toEqual({
      prefill: {
        templateId: "t1",
        subject: "Save the date!",
        body: "Body",
        filter: { guest_ids: ["g1"], event_ids: ["e1"] },
      },
    });
  });

  it("offers no resend on a row still queued or sending", async () => {
    adminRequest.mockResolvedValue(
      makeDetail({
        recipients: [
          {
            id: "r1",
            send_id: "s1",
            guest_id: "g1",
            guest_name: "Alice",
            party_name: "The Smiths",
            email_address: "alice@example.com",
            status: "queued",
            created_at: "2026-06-01T18:00:00Z",
            updated_at: "2026-06-01T18:00:00Z",
          },
          {
            id: "r2",
            send_id: "s1",
            guest_id: "g2",
            guest_name: "Bob",
            party_name: "The Smiths",
            email_address: "bob@example.com",
            status: "delivered",
            created_at: "2026-06-01T18:00:00Z",
            updated_at: "2026-06-01T18:00:00Z",
          },
        ],
      }),
    );
    renderDetail();

    expect(
      await screen.findByRole("link", { name: "Resend to Bob" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Resend to Alice" }),
    ).not.toBeInTheDocument();
  });

  it("offers no resend on a test send", async () => {
    adminRequest.mockResolvedValue(
      makeDetail({
        is_test: true,
        recipients: [
          {
            id: "r1",
            send_id: "s1",
            guest_id: "g1",
            guest_name: "Alice",
            party_name: "The Smiths",
            email_address: "us@example.com",
            status: "sent",
            created_at: "2026-06-01T18:00:00Z",
            updated_at: "2026-06-01T18:00:00Z",
          },
        ],
      }),
    );
    renderDetail();

    expect(await screen.findByText("us@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Resend/ })).toBeNull();
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
