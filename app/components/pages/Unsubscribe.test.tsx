import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Unsubscribe from "@/components/pages/Unsubscribe";
import { ApiError } from "@/libraries/api";
import type { SubscriptionResponse } from "@/types/generated/subscriptions";

const apiRequest = vi.fn();
vi.mock("@/libraries/api", async () => {
  const actual = await vi.importActual<object>("@/libraries/api");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  };
});

function makeData(
  overrides: Partial<SubscriptionResponse> = {},
): SubscriptionResponse {
  return {
    full_name: "Alice Smith",
    email: "alice@example.com",
    subscribed: true,
    ...overrides,
  };
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/u/g1"]}>
        <Routes>
          <Route element={<Unsubscribe />} path="/u/:guestId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequest.mockReset();
});

describe("Unsubscribe", () => {
  it("greets by first name and unsubscribes on click", async () => {
    apiRequest
      .mockResolvedValueOnce(makeData({ subscribed: true }))
      .mockResolvedValueOnce(makeData({ subscribed: false }));

    renderPage();

    expect(await screen.findByText("Hi Alice,")).toBeInTheDocument();
    expect(
      screen.getByText(
        /currently getting our wedding email updates at alice@example.com/i,
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Unsubscribe" }));

    // The POST carries the desired state; the page then re-renders unsubscribed.
    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("/subscriptions/g1", {
        method: "POST",
        body: { subscribed: false },
      }),
    );
    expect(
      await screen.findByText(/You're unsubscribed, Alice\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Resubscribe" }),
    ).toBeInTheDocument();
  });

  it("resubscribes from the unsubscribed state", async () => {
    apiRequest
      .mockResolvedValueOnce(makeData({ subscribed: false }))
      .mockResolvedValueOnce(makeData({ subscribed: true }));

    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Resubscribe" }),
    );

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith("/subscriptions/g1", {
        method: "POST",
        body: { subscribed: true },
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Unsubscribe" }),
    ).toBeInTheDocument();
  });

  it("shows a friendly dead end for a stale link", async () => {
    apiRequest.mockRejectedValueOnce(
      new ApiError(404, "Guest not found.", "not_found"),
    );

    renderPage();

    expect(
      await screen.findByText("This link is no longer valid"),
    ).toBeInTheDocument();
  });

  it("surfaces an error when the update fails", async () => {
    apiRequest
      .mockResolvedValueOnce(makeData({ subscribed: true }))
      .mockRejectedValueOnce(new ApiError(500, "Server error"));

    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Unsubscribe" }),
    );

    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
