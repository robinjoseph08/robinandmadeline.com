import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import Home from "@/components/pages/Home";
import { HERO_IMAGE, WEDDING } from "@/components/pages/home-content";

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
    // The date also appears in the countdown below, so more than one match.
    expect(screen.getAllByText(WEDDING.dateText).length).toBeGreaterThan(0);
    expect(screen.getByText(WEDDING.venueText)).toBeInTheDocument();
  });

  it("renders the hero photo with descriptive alt text", () => {
    renderHome();

    const photo = screen.getByRole("img", { name: HERO_IMAGE.alt });
    expect(photo).toHaveAttribute("src", HERO_IMAGE.fallbackSrc);
    // Intrinsic dimensions so the layout reserves space before the photo loads.
    expect(photo).toHaveAttribute("width", String(HERO_IMAGE.width));
    expect(photo).toHaveAttribute("height", String(HERO_IMAGE.height));
  });

  it("renders a live countdown to the wedding", () => {
    renderHome();

    expect(
      screen.getByRole("region", { name: /countdown to the wedding/i }),
    ).toBeInTheDocument();
    for (const label of ["Days", "Hours", "Minutes", "Seconds"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
