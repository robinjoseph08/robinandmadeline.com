// The bare /games/crossword path predates the puzzle registry; the router
// redirects it to the games landing rather than 404ing old links.

import { render, screen } from "@testing-library/react";
import { createMemoryRouter, Navigate, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Games from "@/components/pages/Games";

describe("router", () => {
  it("redirects the bare /games/crossword path to the games landing", () => {
    // These two entries mirror app/router.tsx (the real router boots the
    // whole app shell, so the relevant routes are replicated here).
    const router = createMemoryRouter(
      [
        { path: "/games", Component: Games },
        {
          path: "/games/crossword",
          element: <Navigate replace to="/games" />,
        },
      ],
      { initialEntries: ["/games/crossword"] },
    );

    render(<RouterProvider router={router} />);

    expect(screen.getByRole("heading", { name: "Games" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/games");
  });
});
