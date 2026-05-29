import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { NAV_LINKS } from "@/components/library/nav-links";
import NavBar from "@/components/library/NavBar";

function renderNav() {
  return render(
    <MemoryRouter>
      <NavBar />
    </MemoryRouter>,
  );
}

describe("NavBar", () => {
  it("renders every primary navigation link on desktop", () => {
    renderNav();

    for (const link of NAV_LINKS) {
      // Each label appears as a link pointing at its route.
      const matches = screen.getAllByRole("link", { name: link.label });
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0]).toHaveAttribute("href", link.to);
    }
  });

  it("toggles the mobile menu via the hamburger button", async () => {
    const user = userEvent.setup();
    renderNav();

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
});
