import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Home from "@/components/pages/Home";
import {
  HERO_IMAGE,
  HOME_CTA_CARDS,
  WEDDING,
} from "@/components/pages/home-content";

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
    expect(screen.getByText(WEDDING.tagline)).toBeInTheDocument();
    expect(screen.getByText(WEDDING.dateText)).toBeInTheDocument();
    expect(screen.getByText(WEDDING.venueText)).toBeInTheDocument();
  });

  it("renders the hero photo with descriptive alt text", () => {
    renderHome();

    const photo = screen.getByRole("img", { name: HERO_IMAGE.alt });
    expect(photo).toHaveAttribute("src", HERO_IMAGE.fallbackSrc);
    // Intrinsic dimensions so the layout reserves space before the photo
    // loads instead of shifting the CTA cards down.
    expect(photo).toHaveAttribute("width", String(HERO_IMAGE.width));
    expect(photo).toHaveAttribute("height", String(HERO_IMAGE.height));
  });

  it("renders a CTA card linking to each destination", () => {
    renderHome();

    // Issue #13 requires CTA cards for RSVP, Schedule, and Our Story.
    expect(HOME_CTA_CARDS.map((card) => card.to)).toEqual([
      "/rsvp",
      "/schedule",
      "/story",
    ]);

    for (const card of HOME_CTA_CARDS) {
      const link = screen.getByRole("link", {
        name: new RegExp(card.title, "i"),
      });
      expect(link).toHaveAttribute("href", card.to);
      expect(screen.getByText(card.description)).toBeInTheDocument();
    }
  });

  it("links the RSVP call-to-action to the RSVP page", () => {
    renderHome();

    const rsvp = screen.getByRole("link", { name: /rsvp/i });
    expect(rsvp).toHaveAttribute("href", "/rsvp");
  });
});
