import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";

import AdminLayout from "@/components/pages/admin/AdminLayout";
import { AuthProvider } from "@/libraries/auth";

function renderLayout() {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route element={<AdminLayout />} path="/admin">
            <Route element={<div>Dashboard content</div>} index />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("AdminLayout", () => {
  it("links back to the public site", () => {
    renderLayout();

    expect(screen.getByRole("link", { name: /back to site/i })).toHaveAttribute(
      "href",
      "/",
    );
  });

  it("renders the routed section content", () => {
    renderLayout();

    expect(screen.getByText("Dashboard content")).toBeInTheDocument();
  });
});
