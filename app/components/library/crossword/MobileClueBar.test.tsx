import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import MobileClueBar from "./MobileClueBar";

describe("MobileClueBar", () => {
  it("shows only clue text and labels the direction toggle", async () => {
    const user = userEvent.setup();
    const onToggleDirection = vi.fn();
    render(
      <MobileClueBar
        clue="Wedding vow response"
        direction="across"
        onNext={() => {}}
        onPrevious={() => {}}
        onToggleDirection={onToggleDirection}
        visible
      />,
    );

    const toggle = screen.getByRole("button", {
      name: "Switch to down clues",
    });
    expect(toggle).toHaveTextContent("Wedding vow response");
    expect(toggle).not.toHaveTextContent(/\b\d+\s*[AD]\b/);

    await user.click(toggle);
    expect(onToggleDirection).toHaveBeenCalledOnce();
  });

  it("preserves authored line breaks without clipping a multiline clue", () => {
    render(
      <MobileClueBar
        clue={"First line\n\nMadeline note"}
        direction="down"
        onNext={() => {}}
        onPrevious={() => {}}
        onToggleDirection={() => {}}
        visible
      />,
    );

    const clue = screen.getByText(/First line/);
    expect(clue).toHaveClass("whitespace-pre-line");
    expect(clue.className).not.toContain("line-clamp-");
    expect(clue.textContent).toBe("First line\n\nMadeline note");
  });

  it("announces switching back to across clues from a down clue", () => {
    render(
      <MobileClueBar
        clue="Reception dance"
        direction="down"
        onNext={() => {}}
        onPrevious={() => {}}
        onToggleDirection={() => {}}
        visible
      />,
    );

    expect(
      screen.getByRole("button", { name: "Switch to across clues" }),
    ).toBeInTheDocument();
  });
});
