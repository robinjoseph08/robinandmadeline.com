import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Initials from "@/components/library/Initials";

describe("Initials", () => {
  it("exposes an accessible name and the ring mark by default", () => {
    const { container } = render(<Initials />);

    // Named for screen readers as the couple, since it can stand alone (e.g. the
    // mobile menu's top bar).
    const mark = screen.getByRole("img", { name: "Robin and Madeline" });
    // The ring and letters take their color from a text class via currentColor.
    expect(mark).toHaveAttribute("fill", "currentColor");
    // The ring is the defining feature of the mark.
    expect(container.querySelector("circle")).not.toBeNull();
  });

  it("hides itself from assistive tech when decorative", () => {
    const { container } = render(<Initials decorative />);

    // Inside an already-labeled link the mark must not announce a second time.
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
