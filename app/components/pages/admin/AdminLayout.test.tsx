import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
            <Route element={<div>Guests content</div>} path="guests" />
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

  it("opens the navigation drawer from the mobile menu button", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(
      screen.getByRole("button", { name: /open admin navigation/i }),
    );

    // The drawer mounts as a dialog carrying the same section links and the
    // back-to-site exit, so the nav is fully reachable on mobile.
    const drawer = await screen.findByRole("dialog");
    expect(
      within(drawer).getByRole("link", { name: "Guests" }),
    ).toHaveAttribute("href", "/admin/guests");
    expect(
      within(drawer).getByRole("link", { name: /back to site/i }),
    ).toHaveAttribute("href", "/");
    // The decorative monogram is hidden from AT, so the brand link's name is
    // just "Admin" (not "Robin and Madeline floral monogram Admin").
    expect(within(drawer).getByRole("link", { name: "Admin" })).toHaveAttribute(
      "href",
      "/admin",
    );
  });

  it("closes the drawer after navigating to a section", async () => {
    const user = userEvent.setup();
    renderLayout();

    await user.click(
      screen.getByRole("button", { name: /open admin navigation/i }),
    );
    const drawer = await screen.findByRole("dialog");

    await user.click(within(drawer).getByRole("link", { name: "Guests" }));

    // Following a link navigates and dismisses the drawer (its onNavigate plus
    // the route-change reset), and the routed section renders.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Guests content")).toBeInTheDocument();
  });
});
