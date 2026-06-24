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

  it("renders the expected photo count in every milestone", () => {
    render(<Story />);

    // How we met, the first date, and the proposal each show two overlapping
    // photos; the wedding shows one. Lock the counts so a dropped cluster photo
    // (or a stray placeholder) fails rather than silently shipping.
    const expectedCounts = [2, 2, 2, 1];
    const items = screen.getAllByRole("listitem");
    items.forEach((item, index) => {
      expect(within(item).getAllByRole("img")).toHaveLength(
        expectedCounts[index],
      );
    });
    expect(screen.getAllByRole("img")).toHaveLength(7);
    expect(screen.queryByText(/photo coming soon/i)).not.toBeInTheDocument();
  });

  it("gives every photo descriptive alt text", () => {
    render(<Story />);

    // Each photo must have a non-empty accessible name (an empty alt would make
    // it presentational and drop out of the count above).
    for (const img of screen.getAllByRole("img")) {
      expect(img).toHaveAccessibleName();
    }
    // A few distinctive ones, to catch a swapped or wrong alt.
    expect(
      screen.getByAltText(/first Hinge conversation/i),
    ).toBeInTheDocument();
    expect(screen.getByAltText(/BCD Tofu House/i)).toBeInTheDocument();
    expect(screen.getByAltText(/presenting the ring/i)).toBeInTheDocument();
    expect(screen.getByAltText(/engagement shoot/i)).toBeInTheDocument();
  });

  it("reveals every milestone (none left in the hidden state)", () => {
    render(<Story />);

    // jsdom has no IntersectionObserver, so useInView reveals immediately; every
    // milestone must carry the revealed classes. This pins the reveal mapping so
    // an inverted ternary (which would hide everything in a real browser) fails.
    for (const item of screen.getAllByRole("listitem")) {
      expect(item).toHaveClass("opacity-100");
      expect(item).not.toHaveClass("opacity-0");
    }
  });

  it("stacks the front photo above the others in a cluster", () => {
    render(<Story />);

    // In "How we met" the crossword conversation sits in front of the interests
    // list. Each framed print is the nearest <span> wrapping its <img>.
    const front = screen
      .getByAltText(/first Hinge conversation/i)
      .closest("span");
    const back = screen.getByAltText(/list of interests/i).closest("span");
    expect(front).toHaveClass("z-10");
    expect(back).toHaveClass("z-0");
  });

  it("closes the wedding with a blue heart then a pink heart", () => {
    render(<Story />);

    const wedding = screen
      .getByRole("heading", { name: "The wedding" })
      .closest("li");
    // Order matters: blue first, then pink, matching the site's blue+pink motif.
    const hearts = [...(wedding?.querySelectorAll("svg") ?? [])];
    expect(hearts).toHaveLength(2);
    expect(hearts[0]).toHaveClass("fill-blue");
    expect(hearts[1]).toHaveClass("fill-rose");
  });

  it("renders blue and pink highlight marks", () => {
    const { container } = render(<Story />);

    // <Blue> is a periwinkle chip with blue text; <Pink> a rose chip with rose
    // text. Asserting both colors appear catches a swap or a dropped highlight.
    expect(
      container.querySelectorAll("span.bg-secondary.text-blue").length,
    ).toBeGreaterThan(0);
    expect(
      container.querySelectorAll("span.bg-rose-soft.text-rose").length,
    ).toBeGreaterThan(0);
  });
});
