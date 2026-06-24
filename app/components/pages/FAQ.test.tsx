import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";

import FAQ from "@/components/pages/FAQ";

// Each question inlined in FAQ.tsx, paired with a snippet from every paragraph
// of its answer (so multi-paragraph answers are fully covered). Kept here
// rather than imported now that the copy lives as JSX in the component itself.
const FAQ_ITEMS = [
  {
    question: "Where will the wedding take place?",
    answers: ["This is in Palmer, TX."],
  },
  {
    question: "Do I need to rent a car?",
    answers: ["We definitely recommend having a car"],
  },
  {
    question: "What's a Madhuram Veppu?",
    answers: [
      "traditional ceremony that happens on the day before a Kerala wedding",
      "Sweetening Ceremony",
    ],
  },
  {
    question: "What's the dress code for the events?",
    answers: [
      "the dress code is semi-formal",
      "the ceremony and reception will be outdoors",
    ],
  },
  {
    question: "Do you have a gift registry?",
    answers: [
      "Your presence at our wedding is gift enough",
      "not bring any boxed gifts",
    ],
  },
];

// The exact Zelle deep link from the source copy. Pinned in full (not just the
// host) because it is a payment link: a corrupted token would route money to
// the wrong recipient, so any drift should fail the test.
const ZELLE_URL =
  "https://enroll.zellepay.com/qr-codes?data=ewogICJ0b2tlbiIgOiAiOTcyNzU0NzIzNyIsCiAgImFjdGlvbiIgOiAicGF5bWVudCIsCiAgIm5hbWUiIDogIlJPQklOIgp9";

function renderFAQ() {
  return render(
    <MemoryRouter>
      <FAQ />
    </MemoryRouter>,
  );
}

// Reports the current router path so a test can prove client-side navigation.
function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
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
      for (const snippet of item.answers) {
        expect(panel).toHaveTextContent(snippet);
      }
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

  it("preserves the external links from the source copy", () => {
    renderFAQ();

    // Each external link keeps its exact href and opens safely in a new tab.
    const externals = [
      {
        name: "Arrowwood Weddings & Events",
        href: "https://arrowwoodevents.com/",
      },
      { name: "Venmo", href: "https://venmo.com/u/robinjoseph08" },
      { name: "Zelle", href: ZELLE_URL },
    ];
    for (const { name, href } of externals) {
      const link = screen.getByText(name);
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  it("navigates within the app when the Travel link is clicked", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/faq"]}>
        <FAQ />
        <LocationProbe />
      </MemoryRouter>,
    );

    // The link lives in a collapsed panel; open it the way a guest would.
    await user.click(
      screen.getByRole("button", { name: "Do I need to rent a car?" }),
    );
    const travel = screen.getByRole("link", { name: "Travel" });
    expect(travel).toHaveAttribute("href", "/travel");

    await user.click(travel);

    // Client-side navigation updates the router location without a full
    // reload; a plain <a href="/travel"> would not change it here.
    expect(screen.getByTestId("location")).toHaveTextContent("/travel");
  });
});
