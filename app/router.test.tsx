// The tests mount the real route table in a memory router, wrapped in the same
// providers index.tsx uses, so routing changes are exercised end to end.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { proposal } from "@/components/library/crossword/puzzle-data-proposal";
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

  it.each(["/games/proposal", "/Games/proposal", "/Games/propo%73al"])(
    "publicly renders the proposal crossword without the footer at %s",
    (path) => {
      renderAt(path);

      // getByText rather than a role query: the first visit opens the modal
      // start dialog, which marks the page behind it aria-hidden.
      expect(screen.getByText(proposal.title)).toBeInTheDocument();
      expect(
        screen.getByRole("dialog", { name: /ready to solve/i }),
      ).toBeInTheDocument();
      expect(document.querySelector("footer")).toBeNull();
    },
  );

  it.each(["mini", "crossword", "does-not-exist"])(
    "shows the friendly not-found treatment for retired or unknown slug %s",
    (slug) => {
      renderAt(`/games/${slug}`);

      expect(
        screen.getByRole("heading", { name: /can't find that puzzle/i }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /games page/i })).toHaveAttribute(
        "href",
        "/games",
      );
      expect(document.querySelector("footer")).not.toBeNull();
    },
  );

  it("keeps the public games landing at /games", () => {
    renderAt("/games");

    expect(screen.getByRole("heading", { name: "Games" })).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /proposal crossword/i }),
    ).toHaveAttribute("href", "/games/proposal");
    expect(document.querySelector("footer")).not.toBeNull();
  });

  it("renders the Travel page at /travel", () => {
    renderAt("/travel");

    expect(screen.getByRole("heading", { name: "Travel" })).toBeInTheDocument();
  });

  it("wires the unsubscribe page at /u/:guestId", () => {
    const router = renderAt("/u/some-guest-id");

    expect(router.state.location.pathname).toBe("/u/some-guest-id");
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});
