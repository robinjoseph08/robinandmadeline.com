import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Games from "@/components/pages/Games";

describe("Games", () => {
  it("renders the games landing with links to both crosswords", () => {
    render(
      <MemoryRouter>
        <Games />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: /games/i })).toBeInTheDocument();

    const mini = screen.getByRole("link", { name: /mini crossword/i });
    expect(mini).toHaveAttribute("href", "/games/crossword/mini");

    const full = screen.getByRole("link", { name: /fifteen-by-fifteen/i });
    expect(full).toHaveAttribute("href", "/games/crossword/full");
  });
});
