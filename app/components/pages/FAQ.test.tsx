import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import FAQ from "@/components/pages/FAQ";

// The questions inlined in FAQ.tsx, each paired with a snippet of its answer.
// Kept here (rather than imported) now that the content lives as JSX in the
// component itself.
const FAQ_ITEMS = [
  {
    question: "Where will the wedding take place?",
    answer: "This is in Palmer, TX.",
  },
  {
    question: "Do I need to rent a car?",
    answer: "We definitely recommend having a car",
  },
  {
    question: "What's a Madhuram Veppu?",
    answer: "Sweetening Ceremony",
  },
  {
    question: "What's the dress code for the events?",
    answer: "the dress code is semi-formal",
  },
  {
    question: "Do you have a gift registry?",
    answer: "Your presence at our wedding is gift enough",
  },
];

function renderFAQ() {
  return render(
    <MemoryRouter>
      <FAQ />
    </MemoryRouter>,
  );
}

// The answer panel a question's toggle controls. It stays mounted while
// collapsed (just hidden), so reach it through the toggle's aria-controls.
function panelFor(question: string) {
  const toggle = screen.getByRole("button", { name: question });
  const panelId = toggle.getAttribute("aria-controls") ?? "";
  const panel = document.getElementById(panelId);
  if (!panel) throw new Error(`No answer panel found for: ${question}`);
  return panel;
}

describe("FAQ", () => {
  it("renders the page heading and subtitle", () => {
    renderFAQ();

    expect(
      screen.getByRole("heading", { name: /frequently asked questions/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Answers to the things guests ask us most."),
    ).toBeInTheDocument();
  });

  it("renders every question collapsed, with answers hidden", () => {
    renderFAQ();

    for (const item of FAQ_ITEMS) {
      const toggle = screen.getByRole("button", { name: item.question });
      const panel = panelFor(item.question);
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(panel).toHaveAttribute("role", "region");
      expect(panel).toHaveTextContent(item.answer);
      expect(panel).not.toBeVisible();
    }
  });

  it("expands an answer when its question is clicked", async () => {
    const user = userEvent.setup();
    renderFAQ();

    const item = FAQ_ITEMS[0];
    await user.click(screen.getByRole("button", { name: item.question }));

    expect(screen.getByRole("button", { name: item.question })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(panelFor(item.question)).toBeVisible();
  });

  it("collapses an expanded answer when the question is clicked again", async () => {
    const user = userEvent.setup();
    renderFAQ();

    const item = FAQ_ITEMS[0];
    const toggle = screen.getByRole("button", { name: item.question });
    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(panelFor(item.question)).not.toBeVisible();
  });

  it("expands questions independently of each other", async () => {
    const user = userEvent.setup();
    renderFAQ();

    const [first, second] = FAQ_ITEMS;
    await user.click(screen.getByRole("button", { name: first.question }));

    expect(panelFor(first.question)).toBeVisible();
    expect(panelFor(second.question)).not.toBeVisible();

    // Both can be open at once; this is not an exclusive accordion.
    await user.click(screen.getByRole("button", { name: second.question }));

    expect(panelFor(first.question)).toBeVisible();
    expect(panelFor(second.question)).toBeVisible();

    // Collapsing one leaves the other open.
    await user.click(screen.getByRole("button", { name: first.question }));

    expect(panelFor(first.question)).not.toBeVisible();
    expect(panelFor(second.question)).toBeVisible();
  });

  it("links the Travel reference internally and preserves external links", () => {
    renderFAQ();

    // The Travel reference points at the in-app route, not an external URL.
    expect(screen.getByText("Travel")).toHaveAttribute("href", "/travel");

    // Links carried over from the source copy are preserved verbatim.
    expect(screen.getByText("Arrowwood Weddings & Events")).toHaveAttribute(
      "href",
      "https://arrowwoodevents.com/",
    );
    expect(screen.getByText("Venmo")).toHaveAttribute(
      "href",
      "https://venmo.com/u/robinjoseph08",
    );
    expect(screen.getByText("Zelle")).toHaveAttribute(
      "href",
      expect.stringContaining("enroll.zellepay.com"),
    );
  });
});
