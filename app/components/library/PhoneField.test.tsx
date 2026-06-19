import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { PhoneField } from "@/components/library/PhoneField";

// PhoneField is controlled, so a tiny wrapper owns the value the way a real
// form does.
function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <PhoneField
      id="phone"
      onChange={setValue}
      placeholder="9725551234"
      value={value}
    />
  );
}

describe("PhoneField", () => {
  it("formats a US number as it is typed", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // The user types bare digits; the field punctuates them live so they know
    // they don't have to.
    const phone = screen.getByRole("textbox");
    await user.type(phone, "9725551234");
    expect(phone).toHaveValue("(972) 555-1234");
  });

  it("keeps the caret beside the edited digit when inserting mid-number", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const phone = screen.getByRole<HTMLInputElement>("textbox");
    await user.type(phone, "9725551234");
    expect(phone).toHaveValue("(972) 555-1234");

    // Drop a digit in right after the area code (position 6, before the first
    // "5"). The rest of the number reflows, but the caret stays beside the
    // inserted digit instead of snapping to the end.
    await user.type(phone, "0", {
      initialSelectionStart: 6,
      initialSelectionEnd: 6,
    });
    expect(phone).toHaveValue("(972) 055-51234");
    expect(phone.selectionStart).toBe(7);
  });

  it("shows the placeholder when empty and leaves an international number alone", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const phone = screen.getByRole("textbox");
    expect(phone).toHaveAttribute("placeholder", "9725551234");

    // A number written in full international form (leading +) is not US, so it
    // passes through untouched rather than being forced into US grouping.
    await user.type(phone, "+442079460958");
    expect(phone).toHaveValue("+442079460958");
  });
});
