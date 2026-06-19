import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NAV_LINKS } from "@/components/library/nav-links";
import SiteHeader from "@/components/library/SiteHeader";
import { AuthProvider } from "@/libraries/auth";

function renderHeader(initialPath = "/") {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
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

  it("closes the mobile menu via its close button", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(
      screen.getByRole("button", { name: /toggle navigation menu/i }),
    );
    expect(screen.getByTestId("mobile-menu")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /close navigation menu/i }),
    );
    expect(screen.queryByTestId("mobile-menu")).not.toBeInTheDocument();
  });

  it("closes the mobile menu when navigating via the logo", async () => {
    const user = userEvent.setup();
    // Start off the home page so the logo navigates to a different route.
    renderHeader("/story");

    await user.click(
      screen.getByRole("button", { name: /toggle navigation menu/i }),
    );
    expect(screen.getByTestId("mobile-menu")).toBeInTheDocument();

    // The logo has no explicit close handler, so this exercises the
    // route-change reset rather than the per-link onNavigate path.
    await user.click(
      screen.getByRole("link", { name: /robin and madeline, home/i }),
    );

    expect(screen.queryByTestId("mobile-menu")).not.toBeInTheDocument();
  });

  it("marks the active route and leaves the others unmarked", () => {
    renderHeader("/story");

    // NavLink sets aria-current="page" on the active route. Home carries `end`,
    // so it must not match /story (the bug a missing `end` would introduce).
    const [story] = screen.getAllByRole("link", { name: "Our Story" });
    expect(story).toHaveAttribute("aria-current", "page");
    const [home] = screen.getAllByRole("link", { name: "Home" });
    expect(home).not.toHaveAttribute("aria-current");
  });

  it("includes the Admin link inside the mobile menu when authenticated", async () => {
    const user = userEvent.setup();
    localStorage.setItem("admin_token", "a.jwt.token");
    renderHeader();

    await user.click(
      screen.getByRole("button", { name: /toggle navigation menu/i }),
    );

    // The mobile menu must carry the same authenticated items as the desktop
    // nav, including the appended Admin link (not bare NAV_LINKS).
    const menu = screen.getByTestId("mobile-menu");
    expect(within(menu).getByRole("link", { name: "Admin" })).toHaveAttribute(
      "href",
      "/admin",
    );
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

  it("shows the compact monogram brand on the home overlay", () => {
    renderHeader("/");

    // On the home page the full names live on the hero photo, so the header
    // shows only the compact "R&M" mark (no spelled-out names).
    const brand = screen.getByRole("link", {
      name: /robin and madeline, home/i,
    });
    expect(brand).toHaveTextContent(/^R&M$/);
    expect(brand).not.toHaveTextContent(/Madeline/);
  });

  it("shows the compact mark on mobile and the script names on desktop off home", () => {
    renderHeader("/story");

    const brand = screen.getByRole("link", {
      name: /robin and madeline, home/i,
    });
    // jsdom applies no CSS, so both variants are in the DOM; assert the
    // responsive contract via classes instead. Inverting the two (the bug a
    // class swap would introduce) flips which is shown at each breakpoint.
    // Mobile mark: the compact "R&M", visible by default and hidden at md+.
    const compact = brand.querySelector(".md\\:hidden");
    expect(compact).not.toBeNull();
    expect(compact).toHaveTextContent(/^R&M$/);
    expect(compact).not.toHaveClass("hidden");
    // Desktop mark: the script names, hidden on mobile and shown at md+.
    const names = brand.querySelector(".md\\:inline-block");
    expect(names).not.toBeNull();
    expect(names).toHaveClass("hidden");
    expect(names).toHaveTextContent(/Robin/);
    expect(names).toHaveTextContent(/Madeline/);
  });
});
