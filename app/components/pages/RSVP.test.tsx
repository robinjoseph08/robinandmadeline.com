import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RSVP from "@/components/pages/RSVP";
import { GUEST_TOKEN_STORAGE_KEY } from "@/libraries/guest-api";

function renderRSVP() {
  return render(
    <MemoryRouter initialEntries={["/rsvp"]}>
      <Routes>
        <Route element={<RSVP />} path="/rsvp" />
        <Route element={<div>RSVP Form Page</div>} path="/rsvp/form" />
        <Route
          element={<div>Confirmation Page</div>}
          path="/rsvp/confirmation"
        />
      </Routes>
    </MemoryRouter>,
  );
}

/** A minimal GET /api/guest/rsvp body with the routing-relevant flags. */
function rsvpBody(overrides: { responded?: boolean; closed?: boolean } = {}) {
  return {
    guests: [],
    events: [],
    responded: false,
    closed: false,
    rsvp_deadline: null,
    contact_email: null,
    ...overrides,
  };
}

/**
 * Mocks fetch for the login flow: POST /api/auth/guest/login returns a token,
 * then GET /api/guest/rsvp returns the given body (whose responded/closed
 * flags drive where the visitor lands).
 */
function mockLoginFetch(body: Record<string, unknown>) {
  const fetchMock = vi
    .fn()
    .mockImplementation((url: string) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            url === "/api/auth/guest/login" ? { token: "a.guest.jwt" } : body,
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("RSVP", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("exchanges a valid code for a token and continues to the form", async () => {
    const fetchMock = mockLoginFetch(rsvpBody());

    const user = userEvent.setup();
    renderRSVP();

    await user.type(screen.getByLabelText(/party code/i), "kalel");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    // The token is persisted so returning visitors skip code entry.
    await waitFor(() => {
      expect(localStorage.getItem(GUEST_TOKEN_STORAGE_KEY)).toBe("a.guest.jwt");
    });

    // The code is sent uppercased (the field uppercases as the guest types).
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/guest/login",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ code: "KALEL" });

    // An unresponded party lands on the form.
    expect(await screen.findByText("RSVP Form Page")).toBeInTheDocument();
  });

  it("continues to the confirmation when the party has already responded", async () => {
    mockLoginFetch(rsvpBody({ responded: true }));

    const user = userEvent.setup();
    renderRSVP();

    await user.type(screen.getByLabelText(/party code/i), "kalel");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText("Confirmation Page")).toBeInTheDocument();
  });

  it("continues to the confirmation after the deadline", async () => {
    mockLoginFetch(rsvpBody({ closed: true }));

    const user = userEvent.setup();
    renderRSVP();

    await user.type(screen.getByLabelText(/party code/i), "kalel");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByText("Confirmation Page")).toBeInTheDocument();
  });

  it("shows an error and stores no token for an unknown code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "unauthorized",
            message: "Invalid RSVP code.",
            status_code: 401,
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderRSVP();

    await user.type(screen.getByLabelText(/party code/i), "WRONG");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn't find that code/i,
    );
    expect(localStorage.getItem(GUEST_TOKEN_STORAGE_KEY)).toBeNull();
  });

  it("shows a slow-down message when the login is rate limited", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "too_many_requests",
            message: "Too many login attempts.",
            status_code: 429,
          },
        }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderRSVP();

    await user.type(screen.getByLabelText(/party code/i), "KALEL");
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /too many attempts/i,
    );
  });

  it("skips code entry for a returning visitor whose token is still valid", async () => {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "still.valid.jwt");
    // The mount probe (GET /api/guest/rsvp) succeeding proves the token works.
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(rsvpBody()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderRSVP();

    expect(await screen.findByText("RSVP Form Page")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/guest/rsvp",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer still.valid.jwt",
        }),
      }),
    );
  });

  it("sends a returning visitor who already responded to the confirmation", async () => {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "still.valid.jwt");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(rsvpBody({ responded: true })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderRSVP();

    expect(await screen.findByText("Confirmation Page")).toBeInTheDocument();
  });

  it("sends a returning visitor to the confirmation after the deadline", async () => {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "still.valid.jwt");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(rsvpBody({ closed: true })), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderRSVP();

    expect(await screen.findByText("Confirmation Page")).toBeInTheDocument();
  });

  it("clears an expired stored token and falls back to code entry", async () => {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "expired.jwt");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "unauthorized",
            message: "Invalid or expired token.",
            status_code: 401,
          },
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderRSVP();

    expect(await screen.findByLabelText(/party code/i)).toBeInTheDocument();
    expect(localStorage.getItem(GUEST_TOKEN_STORAGE_KEY)).toBeNull();
  });
});
