import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import MobileKeyboard from "./MobileKeyboard";

describe("MobileKeyboard", () => {
  it("renders deterministic 10, 9, and 7 letter rows with a wide delete key", () => {
    render(<MobileKeyboard onBackspace={() => {}} onLetter={() => {}} />);

    const firstRow = screen.getByTestId("crossword-keyboard-row-1");
    const secondRow = screen.getByTestId("crossword-keyboard-row-2");
    const thirdRow = screen.getByTestId("crossword-keyboard-row-3");

    expect(within(firstRow).getAllByRole("button")).toHaveLength(10);
    expect(within(secondRow).getAllByRole("button")).toHaveLength(9);
    expect(secondRow).toHaveClass("mx-auto", "w-[90%]");
    expect(secondRow).not.toHaveClass("w-full", "mx-[5%]");
    expect(
      within(thirdRow).getAllByRole("button", { name: /^Enter / }),
    ).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Delete letter" })).toHaveClass(
      "col-span-2",
    );
  });

  it("keeps labels unselectable and invokes accessible keyboard controls", () => {
    const onBackspace = vi.fn();
    const onLetter = vi.fn();
    render(<MobileKeyboard onBackspace={onBackspace} onLetter={onLetter} />);

    const keyboard = screen.getByRole("group", {
      name: "Crossword keyboard",
    });
    const letter = screen.getByRole("button", { name: "Enter Q" });
    const backspace = screen.getByRole("button", { name: "Delete letter" });

    expect(keyboard).toHaveClass("select-none");
    expect(letter).toHaveClass("select-none");
    expect(backspace).toHaveClass("select-none");
    expect(keyboard.className).toContain("safe-area-inset-bottom");

    fireEvent.click(letter);
    fireEvent.click(backspace);

    expect(onLetter).toHaveBeenCalledWith("Q");
    expect(onBackspace).toHaveBeenCalledOnce();
  });
});
