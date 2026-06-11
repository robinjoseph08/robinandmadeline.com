import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Guest } from "@/types/generated/models";

import { GuestFormDialog } from "./GuestFormDialog";

function makeGuest(overrides: Partial<Guest>): Guest {
  return {
    id: "g1",
    party_id: "p1",
    full_name: "Guest",
    tags: [],
    is_primary: false,
    is_child: false,
    is_drinking: false,
    placeholder_text: undefined,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("GuestFormDialog tags", () => {
  it("round-trips a comma-containing tag untouched through open and save", async () => {
    // Tags are open-ended strings and the grid can create one containing a
    // comma. The dialog renders them as chips (never a comma-joined string), so
    // an open followed by a save must not split or alter them.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <GuestFormDialog
        guest={makeGuest({ tags: ["Smith, Esq.", "DJ"] })}
        isPending={false}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
        open
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["Smith, Esq.", "DJ"] }),
    );
  });

  it("adds a typed tag as a chip on Enter and removes one via its chip button", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <GuestFormDialog
        guest={makeGuest({ tags: ["DJ"] })}
        isPending={false}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
        open
      />,
    );

    await user.type(screen.getByLabelText("Tags"), "Bridal Party{Enter}");
    await user.click(screen.getByRole("button", { name: "Remove DJ" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["Bridal Party"] }),
    );
  });
});
