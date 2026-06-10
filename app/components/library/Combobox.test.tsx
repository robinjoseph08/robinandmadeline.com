import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Combobox } from "./Combobox";

const OPTIONS = [
  { value: "robin", label: "Robin" },
  { value: "madeline", label: "Madeline" },
];

describe("Combobox clear affordance", () => {
  it("clears via a real, focusable clear button without opening the popover", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Combobox
        ariaLabel="Side"
        clearable
        onChange={onChange}
        options={OPTIONS}
        value="robin"
      />,
    );

    // The clear affordance is its own labeled button (keyboard reachable), not
    // an icon swallowed inside the trigger.
    const clear = screen.getByRole("button", { name: "Clear Side" });
    clear.focus();
    expect(clear).toHaveFocus();

    await user.click(clear);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(undefined);
    // Clearing does not open the dropdown.
    expect(screen.queryByPlaceholderText("Search...")).not.toBeInTheDocument();
  });

  it("clears the selection with Backspace or Delete on the trigger", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Combobox
        ariaLabel="Side"
        clearable
        onChange={onChange}
        options={OPTIONS}
        value="robin"
      />,
    );

    screen.getByRole("combobox", { name: "Side" }).focus();
    await user.keyboard("{Backspace}");
    expect(onChange).toHaveBeenCalledWith(undefined);

    await user.keyboard("{Delete}");
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
