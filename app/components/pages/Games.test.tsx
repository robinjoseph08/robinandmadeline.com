import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Games from "@/components/pages/Games";

describe("Games", () => {
  it("renders the games landing with a link to the crossword", () => {
    render(
      <MemoryRouter>
        <Games />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /games/i })).toBeInTheDocument();

    const crossword = screen.getByRole("link", { name: /crossword/i });
    expect(crossword).toHaveAttribute("href", "/games/crossword");
  });
});
