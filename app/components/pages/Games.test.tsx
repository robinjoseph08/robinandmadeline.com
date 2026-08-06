import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Games from "@/components/pages/Games";

const PROPOSAL_BLURB =
  "This is the same crossword grid that Madeline solved when Robin proposed to her. The clues have been adjusted so it's actually possible for other people to solve it. When you solve this puzzle, you'll see the same animation that Madeline saw when she completed it as well.";

function renderGames() {
  return render(
    <MemoryRouter>
      <Games />
    </MemoryRouter>,
  );
}

describe("Games", () => {
  it("publicly lists exactly the Proposal Crossword", () => {
    renderGames();

    expect(screen.getByRole("heading", { name: "Games" })).toBeInTheDocument();
    const games = screen.getAllByRole("link");
    expect(games).toHaveLength(1);
    expect(games[0]).toHaveAccessibleName(/proposal crossword/i);
    expect(games[0]).toHaveAttribute("href", "/games/proposal");
    expect(screen.getByText(PROPOSAL_BLURB)).toBeInTheDocument();
    expect(screen.queryByText("Mini Crossword")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Crossword", { exact: true }),
    ).not.toBeInTheDocument();
  });
});
