import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
