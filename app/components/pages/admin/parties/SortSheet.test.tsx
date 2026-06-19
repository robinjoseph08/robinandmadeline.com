import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { PARTY_SORT_FIELDS } from "./options";
import { SortSheet } from "./SortSheet";

function setup(props: Partial<ComponentProps<typeof SortSheet>> = {}) {
  const onChange = vi.fn();
  const onSaveDefault = vi.fn();
  const onResetDefault = vi.fn();
  render(
    <SortSheet
      fields={PARTY_SORT_FIELDS}
      isDirty={false}
      levels={[{ field: "date_added", direction: "asc" }]}
      onChange={onChange}
      onResetDefault={onResetDefault}
      onSaveDefault={onSaveDefault}
      {...props}
    />,
  );
  return { onChange, onSaveDefault, onResetDefault };
}

function openSheet(user: ReturnType<typeof userEvent.setup>) {
  return user
    .click(screen.getByRole("button", { name: /^Sort/ }))
    .then(() => screen.findByRole("dialog"));
}

describe("SortSheet", () => {
  it("adds a level when an unused field is picked", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    const dialog = await openSheet(user);
    await user.click(within(dialog).getByRole("button", { name: "Name" }));
    expect(onChange).toHaveBeenCalledWith([
      { field: "date_added", direction: "asc" },
      { field: "name", direction: "asc" },
    ]);
  });

  it("toggles a level's direction", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    const dialog = await openSheet(user);
    await user.click(
      within(dialog).getByRole("button", { name: /Date added direction/ }),
    );
    expect(onChange).toHaveBeenCalledWith([
      { field: "date_added", direction: "desc" },
    ]);
  });

  it("removes a level", async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    const dialog = await openSheet(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Remove Date added sort" }),
    );
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("reorders levels with the move buttons", async () => {
    const user = userEvent.setup();
    const { onChange } = setup({
      levels: [
        { field: "date_added", direction: "asc" },
        { field: "name", direction: "asc" },
      ],
    });
    const dialog = await openSheet(user);
    await user.click(
      within(dialog).getByRole("button", { name: "Move Name earlier" }),
    );
    expect(onChange).toHaveBeenCalledWith([
      { field: "name", direction: "asc" },
      { field: "date_added", direction: "asc" },
    ]);
  });

  it("shows the dirty dot and save/reset actions when dirty", async () => {
    const user = userEvent.setup();
    const { onSaveDefault, onResetDefault } = setup({ isDirty: true });
    expect(
      screen.getByLabelText("Sort differs from default"),
    ).toBeInTheDocument();
    const dialog = await openSheet(user);
    await user.click(
      within(dialog).getByRole("button", { name: /Save as default/ }),
    );
    expect(onSaveDefault).toHaveBeenCalledTimes(1);
    await user.click(
      within(dialog).getByRole("button", { name: /Reset to default/ }),
    );
    expect(onResetDefault).toHaveBeenCalledTimes(1);
  });

  it("hides the dirty dot and save/reset when not dirty", async () => {
    const user = userEvent.setup();
    setup({ isDirty: false });
    expect(
      screen.queryByLabelText("Sort differs from default"),
    ).not.toBeInTheDocument();
    const dialog = await openSheet(user);
    expect(
      within(dialog).queryByRole("button", { name: /Save as default/ }),
    ).not.toBeInTheDocument();
  });
});
