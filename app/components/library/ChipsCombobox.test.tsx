import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ChipsCombobox } from "./ChipsCombobox";

// A controlled harness so toggles flow back into the rendered chips.
function Harness({
  initial = [] as string[],
  options = ["Bridal Party", "Cousin", "UIUC"],
}: {
  initial?: string[];
  options?: string[];
}) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <ChipsCombobox
      ariaLabel="Tags"
      onChange={setValue}
      options={options}
      value={value}
    />
  );
}

describe("ChipsCombobox", () => {
  it("toggles options on and off, accumulating a multi-value selection", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("combobox", { name: "Tags" }));
    await user.click(
      await screen.findByRole("option", { name: "Bridal Party" }),
    );
    await user.click(await screen.findByRole("option", { name: "Cousin" }));

    // Both selected values render as chips on the trigger.
    const trigger = screen.getByRole("combobox", { name: "Tags" });
    expect(trigger).toHaveTextContent("Bridal Party");
    expect(trigger).toHaveTextContent("Cousin");

    // Toggling one off removes just that chip.
    await user.click(
      await screen.findByRole("option", { name: "Bridal Party" }),
    );
    expect(trigger).not.toHaveTextContent("Bridal Party");
    expect(trigger).toHaveTextContent("Cousin");
  });

  it("clears the whole selection via the clear affordance", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["Bridal Party", "Cousin"]} />);

    await user.click(screen.getByRole("button", { name: "Clear Tags" }));
    const trigger = screen.getByRole("combobox", { name: "Tags" });
    expect(trigger).not.toHaveTextContent("Bridal Party");
    expect(trigger).not.toHaveTextContent("Cousin");
    expect(trigger).toHaveTextContent("Any");
  });

  it("lists an already-selected value not in the known options so it stays removable", async () => {
    const user = userEvent.setup();
    render(<Harness initial={["Legacy Tag"]} />);

    await user.click(screen.getByRole("combobox", { name: "Tags" }));
    // The selected-but-unknown value appears in the list (checked), so it can
    // be untoggled rather than being stranded on the trigger.
    expect(
      await screen.findByRole("option", { name: "Legacy Tag" }),
    ).toBeInTheDocument();
  });

  it("merges a case-collision into one option using the selected casing so it stays removable", async () => {
    const user = userEvent.setup();
    // The option's casing ("bridal party") collides with the selected value's
    // casing ("Bridal Party"). The merge must collapse them to a single option
    // rendered with the SELECTED casing, so its checkmark matches the selection
    // and toggling it removes the value (rather than appearing as a second,
    // differently-cased entry that could never untoggle the chip).
    render(<Harness initial={["Bridal Party"]} options={["bridal party"]} />);

    await user.click(screen.getByRole("combobox", { name: "Tags" }));

    // Exactly one option, and it carries the selected casing (not the option's).
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(1);
    const option = options[0];
    expect(option).toHaveTextContent("Bridal Party");
    expect(option).not.toHaveTextContent("bridal party");

    // It is shown selected: the check is visible (opacity-100), not hidden.
    const check = option.querySelector("svg");
    expect(check).toHaveClass("opacity-100");
    expect(check).not.toHaveClass("opacity-0");

    // Toggling that single option removes the selection, proving the casing
    // matched the selected value (a mismatched second entry would have added a
    // value instead of clearing the existing one).
    await user.click(option);
    const trigger = screen.getByRole("combobox", { name: "Tags" });
    expect(trigger).not.toHaveTextContent("Bridal Party");
    expect(trigger).toHaveTextContent("Any");
  });
});
