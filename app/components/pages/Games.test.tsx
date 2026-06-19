import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Games from "@/components/pages/Games";
import { AuthProvider } from "@/libraries/auth";

function renderGames() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Games />
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("Games", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("shows a coming-soon note and hides the games for guests", () => {
    renderGames();

    expect(screen.getByRole("heading", { name: "Games" })).toBeInTheDocument();
    expect(screen.getByText(/check back later/i)).toBeInTheDocument();

    // The games are hidden until they're ready: no cards, and none of the
    // admin-only framing leaks to a guest.
    expect(
      screen.queryByRole("link", { name: /mini crossword/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /^Crossword/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/signed in as an admin/i),
    ).not.toBeInTheDocument();
  });

  it("shows the games and an admin-only note when an admin session exists", () => {
    localStorage.setItem("admin_token", "a.jwt.token");

    renderGames();

    // The admin sees why this section is visible to them, and not the guest
    // coming-soon note.
    expect(screen.getByText(/signed in as an admin/i)).toBeInTheDocument();
    expect(screen.queryByText(/check back later/i)).not.toBeInTheDocument();

    const mini = screen.getByRole("link", { name: /mini crossword/i });
    expect(mini).toHaveAttribute("href", "/games/mini");

    // "Crossword" alone also matches "Mini Crossword", so anchor to the start
    // of the accessible name to pin the full puzzle's card by its title.
    const full = screen.getByRole("link", { name: /^Crossword/i });
    expect(full).toHaveAttribute("href", "/games/crossword");
  });
});
