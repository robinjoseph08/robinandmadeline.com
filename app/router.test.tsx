// The bare /games/crossword path predates the puzzle registry; the router
// redirects it to the games landing rather than 404ing old links. The test
// mounts the real route table in a memory router (wrapped in the same
// providers index.tsx uses), so deleting the redirect entry from router.tsx
// fails here.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { AuthProvider } from "@/libraries/auth";
import { routes } from "@/router";

describe("router", () => {
  it("redirects the bare /games/crossword path to the games landing", () => {
    const router = createMemoryRouter(routes, {
      initialEntries: ["/games/crossword"],
    });

    render(
      <QueryClientProvider client={new QueryClient()}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Games" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/games");
  });
});
