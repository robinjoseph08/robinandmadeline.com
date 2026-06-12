import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import FAQ from "@/components/pages/FAQ";
import { FAQ_ITEMS } from "@/components/pages/faq-content";

describe("FAQ", () => {
  it("renders the page heading and subtitle", () => {
    render(<FAQ />);

    expect(
      screen.getByRole("heading", { name: /frequently asked questions/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Answers to the things guests ask us most."),
    ).toBeInTheDocument();
  });

  it("renders every question collapsed, with answers hidden", () => {
    render(<FAQ />);

    for (const item of FAQ_ITEMS) {
      const toggle = screen.getByRole("button", { name: item.question });
      const panel = screen.getByText(item.answer);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveAttribute("aria-controls", panel.id);
      expect(panel).not.toBeVisible();
    }
  });

  it("expands an answer when its question is clicked", async () => {
    const user = userEvent.setup();
    render(<FAQ />);

    const item = FAQ_ITEMS[0];
    await user.click(screen.getByRole("button", { name: item.question }));

    expect(screen.getByRole("button", { name: item.question })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText(item.answer)).toBeVisible();
  });

  it("collapses an expanded answer when the question is clicked again", async () => {
    const user = userEvent.setup();
    render(<FAQ />);

    const item = FAQ_ITEMS[0];
    const toggle = screen.getByRole("button", { name: item.question });
    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(item.answer)).not.toBeVisible();
  });

  it("expands questions independently of each other", async () => {
    const user = userEvent.setup();
    render(<FAQ />);

    const [first, second] = FAQ_ITEMS;
    await user.click(screen.getByRole("button", { name: first.question }));

    expect(screen.getByText(first.answer)).toBeVisible();
    expect(screen.getByText(second.answer)).not.toBeVisible();

    // Both can be open at once; this is not an exclusive accordion.
    await user.click(screen.getByRole("button", { name: second.question }));

    expect(screen.getByText(first.answer)).toBeVisible();
    expect(screen.getByText(second.answer)).toBeVisible();

    // Collapsing one leaves the other open.
    await user.click(screen.getByRole("button", { name: first.question }));

    expect(screen.getByText(first.answer)).not.toBeVisible();
    expect(screen.getByText(second.answer)).toBeVisible();
  });
});
