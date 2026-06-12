import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Story from "@/components/pages/Story";
import { MILESTONES } from "@/components/pages/story-content";

describe("Story", () => {
  it("renders the page heading", () => {
    render(<Story />);

    expect(
      screen.getByRole("heading", { name: /our story/i }),
    ).toBeInTheDocument();
  });

  it("renders every milestone with its date, title, and blurb", () => {
    render(<Story />);

    for (const milestone of MILESTONES) {
      expect(
        screen.getByRole("heading", { name: milestone.title }),
      ).toBeInTheDocument();
      expect(screen.getByText(milestone.blurb)).toBeInTheDocument();
    }
    // Dates are checked in aggregate since placeholder dates may repeat.
    const dates = screen.getAllByText(MILESTONES[0].date);
    expect(dates.length).toBeGreaterThan(0);
  });

  it("renders a photo placeholder for every milestone", () => {
    render(<Story />);

    expect(screen.getAllByText(/photo coming soon/i)).toHaveLength(
      MILESTONES.length,
    );
  });
});
