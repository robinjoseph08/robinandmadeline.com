import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NAV_LINKS } from "@/components/library/nav-links";
import SiteHeader from "@/components/library/SiteHeader";
import { AuthProvider } from "@/libraries/auth";

function renderHeader() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <SiteHeader />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("SiteHeader", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders every primary navigation link", () => {
    renderHeader();

    for (const link of NAV_LINKS) {
      // Each label appears as a link pointing at its route.
      const matches = screen.getAllByRole("link", { name: link.label });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]).toHaveAttribute("href", link.to);
    }
  });

  it("toggles the mobile menu via the hamburger button", async () => {
    const user = userEvent.setup();
    renderHeader();

    expect(screen.queryByTestId("mobile-menu")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /toggle navigation menu/i }),
    );

    const menu = screen.getByTestId("mobile-menu");
    expect(menu).toBeInTheDocument();
    // The expanded mobile menu lists every nav link too.
    for (const link of NAV_LINKS) {
      expect(
        within(menu).getByRole("link", { name: link.label }),
      ).toBeInTheDocument();
    }
  });

  it("hides the Admin link when there is no admin session", () => {
    renderHeader();

    expect(
      screen.queryByRole("link", { name: /admin/i }),
    ).not.toBeInTheDocument();
  });

  it("shows an Admin link to the admin area when an admin session exists", () => {
    localStorage.setItem("admin_token", "a.jwt.token");

    renderHeader();

    const adminLinks = screen.getAllByRole("link", { name: /admin/i });
    expect(adminLinks.length).toBeGreaterThan(0);
    expect(adminLinks[0]).toHaveAttribute("href", "/admin");
  });
});
