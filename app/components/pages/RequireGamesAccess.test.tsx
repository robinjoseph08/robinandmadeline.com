import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import RequireGamesAccess from "@/components/pages/RequireGamesAccess";
import { AuthProvider } from "@/libraries/auth";

function renderAt(initialPath: string) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/games">
            <Route element={<div>Games Landing</div>} index />
            <Route element={<RequireGamesAccess />}>
              <Route element={<div>Crossword Page</div>} path=":puzzleSlug" />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

describe("RequireGamesAccess", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("redirects to the games landing when there is no admin session", () => {
    renderAt("/games/mini");

    expect(screen.getByText("Games Landing")).toBeInTheDocument();
    expect(screen.queryByText("Crossword Page")).not.toBeInTheDocument();
  });

  it("renders the game when an admin session is present", () => {
    localStorage.setItem("admin_token", "a.jwt.token");

    renderAt("/games/mini");

    expect(screen.getByText("Crossword Page")).toBeInTheDocument();
    expect(screen.queryByText("Games Landing")).not.toBeInTheDocument();
  });
});
