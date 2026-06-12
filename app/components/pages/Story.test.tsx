import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Story from "@/components/pages/Story";
import { MILESTONES } from "@/components/pages/story-content";

describe("Story", () => {
  it("renders the page heading and subtitle", () => {
    render(<Story />);

    expect(
      screen.getByRole("heading", { name: /our story/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A few milestones from our journey so far."),
    ).toBeInTheDocument();
  });

  it("renders every milestone in order with its date, title, and blurb", () => {
    render(<Story />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(MILESTONES.length);

    MILESTONES.forEach((milestone, index) => {
      const item = within(items[index]);
      expect(item.getByText(milestone.date)).toBeInTheDocument();
      expect(
        item.getByRole("heading", { name: milestone.title }),
      ).toBeInTheDocument();
      expect(item.getByText(milestone.blurb)).toBeInTheDocument();
    });
  });

  it("renders a photo placeholder for every milestone", () => {
    render(<Story />);

    expect(screen.getAllByText(/photo coming soon/i)).toHaveLength(
      MILESTONES.length,
    );
  });
});
