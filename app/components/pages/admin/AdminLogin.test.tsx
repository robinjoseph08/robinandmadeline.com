import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import AdminLogin from "@/components/pages/admin/AdminLogin";
import { AuthProvider } from "@/libraries/auth";

function renderLogin() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/admin/login"]}>
        <Routes>
          <Route element={<AdminLogin />} path="/admin/login" />
          <Route element={<div>Admin Dashboard</div>} path="/admin" />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("AdminLogin", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("authenticates, stores the token, and redirects to the admin home", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ token: "a.jwt.token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/username/i), "admin");
    await user.type(screen.getByLabelText(/password/i), "correct-horse");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    // Token is persisted client-side.
    await waitFor(() => {
      expect(localStorage.getItem("admin_token")).toBe("a.jwt.token");
    });

    // The login endpoint was called with the entered credentials.
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/admin/login",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      username: "admin",
      password: "correct-horse",
    });

    // And the user lands on the protected admin home.
    expect(await screen.findByText("Admin Dashboard")).toBeInTheDocument();
  });

  it("shows an error message and does not store a token on bad credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message: "invalid username or password" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText(/username/i), "admin");
    await user.type(screen.getByLabelText(/password/i), "wrong");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid/i);
    expect(localStorage.getItem("admin_token")).toBeNull();
  });
});
