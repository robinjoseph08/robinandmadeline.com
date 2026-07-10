import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RequireAdmin from "@/components/pages/admin/RequireAdmin";
import { adminRequest } from "@/libraries/admin-api";
import * as api from "@/libraries/api";
import { ApiError } from "@/libraries/api";
import { AuthProvider } from "@/libraries/auth";

function renderAt(initialPath: string, protectedElement?: React.ReactNode) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<div>Login Page</div>} path="/admin/login" />
          <Route element={<RequireAdmin />} path="/admin">
            <Route
              element={protectedElement ?? <div>Protected Dashboard</div>}
              index
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

/** A protected page that fires an admin request as soon as it mounts. */
function RequestingPage() {
  useEffect(() => {
    void adminRequest("/admin/parties").catch(() => {
      // The 401 clear-and-notify is the behavior under test; swallow the throw.
    });
  }, []);
  return <div>Protected Dashboard</div>;
}

describe("RequireAdmin", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("redirects to the login page when there is no token", () => {
    renderAt("/admin");

    expect(screen.getByText("Login Page")).toBeInTheDocument();
    expect(screen.queryByText("Protected Dashboard")).not.toBeInTheDocument();
  });

  it("renders the protected content when a token is present", () => {
    localStorage.setItem("admin_token", "a.jwt.token");

    renderAt("/admin");

    expect(screen.getByText("Protected Dashboard")).toBeInTheDocument();
    expect(screen.queryByText("Login Page")).not.toBeInTheDocument();
  });

  it("redirects to login when an admin request 401s on a stale token", async () => {
    localStorage.setItem("admin_token", "stale.jwt.token");
    vi.spyOn(api, "apiRequest").mockRejectedValue(
      new ApiError(401, "Invalid or expired token."),
    );

    renderAt("/admin", <RequestingPage />);

    // The 401 clears the token and notifies the auth provider, which flips
    // isAuthenticated to false so the guard redirects to the login page.
    expect(await screen.findByText("Login Page")).toBeInTheDocument();
    expect(screen.queryByText("Protected Dashboard")).not.toBeInTheDocument();
    expect(localStorage.getItem("admin_token")).toBeNull();

    vi.restoreAllMocks();
  });
});
