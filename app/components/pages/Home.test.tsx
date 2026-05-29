import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Home from "@/components/pages/Home";

describe("Home", () => {
  it("renders the heading and an RSVP call-to-action", () => {
    render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("heading", { name: /robin & madeline/i }),
    ).toBeInTheDocument();

    const rsvp = screen.getByRole("link", { name: /rsvp/i });
    expect(rsvp).toHaveAttribute("href", "/rsvp");
  });
});
