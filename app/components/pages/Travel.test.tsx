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

  it.each([
    {
      name: "GLō Best Western Dallas South DeSoto",
      bookingUrl:
        "https://www.bestwestern.com/en_US/book/hotel-rooms.44750.html?groupId=R52AF4Y0",
      websiteUrl: "propertyCode.44750",
      rate: "$129",
    },
    {
      name: "Fairfield by Marriott Inn & Suites Dallas Cedar Hill",
      bookingUrl:
        "https://app.marriott.com/resview2?id=1791312324782&key=GRP&app=resvlink",
      websiteUrl: "daleh-fairfield-inn-and-suites-dallas-cedar-hill",
      rate: "$124",
    },
  ])(
    "links $name to its group rate and own page with its nightly rate",
    ({ name, bookingUrl, websiteUrl, rate }) => {
      render(<Travel />);

      const card = within(screen.getByRole("article", { name }));

      const booking = card.getByRole("link", { name: /Book the group rate/ });
      expect(booking).toHaveAttribute("href", bookingUrl);
      expect(booking).toHaveAttribute("target", "_blank");
      expect(card.getByRole("link", { name: /See the hotel/ })).toHaveAttribute(
        "href",
        expect.stringContaining(websiteUrl),
      );
      expect(card.getByText(rate)).toBeInTheDocument();
      expect(card.getByText("Free parking")).toBeInTheDocument();
    },
  );

  it("lists the block dates once for both hotels", () => {
    render(<Travel />);

    for (const label of ["Just the wedding", "Staying a bit longer"]) {
      expect(screen.getAllByText(label)).toHaveLength(1);
      for (const card of screen.getAllByRole("article")) {
        expect(within(card).queryByText(label)).not.toBeInTheDocument();
      }
    }
  });

  it("lists the group rate booking cutoff", () => {
    render(<Travel />);

    expect(screen.getByText("March 9, 2027")).toBeInTheDocument();
  });

  it("offers an email link for when the block runs out", () => {
    render(<Travel />);

    expect(screen.getByRole("link", { name: "email us" })).toHaveAttribute(
      "href",
      "mailto:wedding@robinandmadeline.com",
    );
  });
});
