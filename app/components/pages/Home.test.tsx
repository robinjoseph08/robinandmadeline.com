import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Home from "@/components/pages/Home";
import { HOME_CTA_CARDS, WEDDING } from "@/components/pages/home-content";

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

describe("Home", () => {
  it("renders the hero with the couple's names, date, and venue", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { name: /robin & madeline/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(WEDDING.dateText)).toBeInTheDocument();
    expect(screen.getByText(WEDDING.venueText)).toBeInTheDocument();
  });

  it("renders a CTA card linking to each destination", () => {
    renderHome();

    for (const card of HOME_CTA_CARDS) {
      const link = screen.getByRole("link", {
        name: new RegExp(card.title, "i"),
      });
      expect(link).toHaveAttribute("href", card.to);
    }
  });

  it("links the RSVP call-to-action to the RSVP page", () => {
    renderHome();

    const rsvp = screen.getByRole("link", { name: /rsvp/i });
    expect(rsvp).toHaveAttribute("href", "/rsvp");
  });
});
