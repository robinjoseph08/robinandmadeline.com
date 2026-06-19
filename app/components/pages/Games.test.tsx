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

    // The games are hidden until they're ready, so the cards never render.
    expect(
      screen.queryByRole("link", { name: /mini crossword/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /fifteen-by-fifteen/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the games and an admin-only note when an admin session exists", () => {
    localStorage.setItem("admin_token", "a.jwt.token");

    renderGames();

    // The admin sees why this section is visible to them.
    expect(screen.getByText(/signed in as an admin/i)).toBeInTheDocument();

    const mini = screen.getByRole("link", { name: /mini crossword/i });
    expect(mini).toHaveAttribute("href", "/games/mini");

    const full = screen.getByRole("link", { name: /fifteen-by-fifteen/i });
    expect(full).toHaveAttribute("href", "/games/crossword");
  });
});
