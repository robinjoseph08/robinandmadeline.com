import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { ChipsCombobox } from "./ChipsCombobox";

// A controlled harness so toggles flow back into the rendered chips.
function Harness({ initial = [] as string[] }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <ChipsCombobox
      ariaLabel="Tags"
      onChange={setValue}
      options={["Bridal Party", "Cousin", "UIUC"]}
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
});
