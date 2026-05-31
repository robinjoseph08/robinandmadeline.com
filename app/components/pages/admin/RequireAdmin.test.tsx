import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import RequireAdmin from "@/components/pages/admin/RequireAdmin";
import { AuthProvider } from "@/libraries/auth";

function renderAt(initialPath: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<div>Login Page</div>} path="/admin/login" />
          <Route element={<RequireAdmin />} path="/admin">
            <Route element={<div>Protected Dashboard</div>} index />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
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
});
