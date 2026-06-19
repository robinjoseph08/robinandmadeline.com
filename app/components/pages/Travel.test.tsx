import { render, screen } from "@testing-library/react";
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

    for (const title of ["Flights", "Hotels", "Rental Cars", "Parking"]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }

    // Each topic is its own labeled section landmark.
    expect(screen.getAllByRole("region")).toHaveLength(4);
  });
});
