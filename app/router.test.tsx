// Each crossword lives at its own short path: /games/mini is the 5x5 mini
// and /games/crossword the full 15x15, resolved through the puzzle registry.
// The tests mount the real route table in a memory router (wrapped in the
// same providers index.tsx uses), so a route table edit that breaks either
// path fails here. The play routes are admin-gated (RequireGamesAccess) while
// the games are unreleased, so the puzzle tests sign in first and a guest is
// sent back to the /games "coming soon" landing.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { weddingMini } from "@/components/library/crossword/puzzle-data";
import { weddingFull } from "@/components/library/crossword/puzzle-data-full";
import { AuthProvider } from "@/libraries/auth";
import { routes } from "@/router";

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe("router", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders the mini at /games/mini", () => {
    localStorage.setItem("admin_token", "a.jwt.token");

    renderAt("/games/mini");

    // getByText rather than a role query: the first visit opens the modal
    // start dialog, which marks the page behind it aria-hidden.
    expect(screen.getByText(weddingMini.title)).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: /ready to solve/i }),
    ).toBeInTheDocument();
  });

  it("renders the full 15x15 at /games/crossword", () => {
    localStorage.setItem("admin_token", "a.jwt.token");

    renderAt("/games/crossword");

    expect(screen.getByText(weddingFull.title)).toBeInTheDocument();
    expect(
      screen.getByRole("dialog", { name: /ready to solve/i }),
    ).toBeInTheDocument();
  });

  it("shows the friendly not-found treatment for an unknown games path", () => {
    localStorage.setItem("admin_token", "a.jwt.token");

    renderAt("/games/does-not-exist");

    expect(
      screen.getByRole("heading", { name: /can't find that puzzle/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /games page/i })).toHaveAttribute(
      "href",
      "/games",
    );
  });

  it("keeps the games landing at /games", () => {
    renderAt("/games");

    expect(screen.getByRole("heading", { name: "Games" })).toBeInTheDocument();
  });

  it("renders the Travel page at /travel", () => {
    // A guest content route (ungated): guards the { path: "travel" } wiring so
    // a broken path or wrong Component can't ship green.
    renderAt("/travel");

    expect(screen.getByRole("heading", { name: "Travel" })).toBeInTheDocument();
  });

  it.each(["mini", "crossword"])(
    "redirects a guest from /games/%s back to the games landing",
    (slug) => {
      // No admin token: the play route is gated, so a guest is sent to the
      // /games landing and its coming-soon note instead of the puzzle.
      const router = renderAt(`/games/${slug}`);

      expect(router.state.location.pathname).toBe("/games");
      expect(
        screen.getByRole("heading", { name: "Games" }),
      ).toBeInTheDocument();
      expect(screen.getByText(/check back later/i)).toBeInTheDocument();
    },
  );
});
