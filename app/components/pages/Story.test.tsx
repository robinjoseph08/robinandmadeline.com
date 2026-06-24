import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Story from "@/components/pages/Story";

// The milestone copy is inlined in the component; this mirrors each milestone's
// title, in order. Dates and body text are left out on purpose: they are
// free-form content the couple edits, so asserting them would be brittle.
const MILESTONE_TITLES = [
  "How we met",
  "The first date",
  "The proposal",
  "The wedding",
];

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

  it("renders every milestone heading in order", () => {
    render(<Story />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(MILESTONE_TITLES.length);

    MILESTONE_TITLES.forEach((title, index) => {
      expect(
        within(items[index]).getByRole("heading", { name: title }),
      ).toBeInTheDocument();
    });
  });

  it("shows a photo in every milestone", () => {
    render(<Story />);

    // Every milestone now has a real photo, so none show the placeholder.
    const items = screen.getAllByRole("listitem");
    for (const item of items) {
      expect(within(item).getByRole("img")).toBeInTheDocument();
    }
    expect(screen.queryByText(/photo coming soon/i)).not.toBeInTheDocument();
  });
});
