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
      </Routes>
    </MemoryRouter>,
  );
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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: "a.guest.jwt" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

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

    expect(await screen.findByText("RSVP Form Page")).toBeInTheDocument();
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
      new Response(JSON.stringify({}), {
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
