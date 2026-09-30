import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Travel from "@/components/pages/Travel";

describe("Travel", () => {
  it("renders the page heading and subtitle", () => {
    render(<Travel />);

    expect(screen.getByRole("heading", { name: "Travel" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "How to get here and where to stay while you celebrate with us.",
      ),
    ).toBeInTheDocument();
  });

  it("renders a titled section for each travel topic", () => {
    render(<Travel />);

    for (const title of ["Hotels", "Flights", "Rental Cars", "Parking"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }

    // Each topic is its own labeled section landmark.
    expect(screen.getAllByRole("region")).toHaveLength(4);
  });

  it("links each hotel block to its group rate and the hotel's own page", () => {
    render(<Travel />);

    const card = within(
      screen.getByRole("article", {
        name: "GLō Best Western Dallas South DeSoto",
      }),
    );

    const booking = card.getByRole("link", { name: /Book the group rate/ });
    expect(booking).toHaveAttribute(
      "href",
      "https://www.bestwestern.com/en_US/book/hotel-rooms.44750.html?groupId=R52AF4Y0",
    );
    expect(booking).toHaveAttribute("target", "_blank");
    expect(card.getByRole("link", { name: /See the hotel/ })).toHaveAttribute(
      "href",
      expect.stringContaining("propertyCode.44750"),
    );
    expect(card.getByText("Free parking")).toBeInTheDocument();
  });

  it("offers an email link for when the block runs out", () => {
    render(<Travel />);

    expect(screen.getByRole("link", { name: "email us" })).toHaveAttribute(
      "href",
      "mailto:wedding@robinandmadeline.com",
    );
  });
});
