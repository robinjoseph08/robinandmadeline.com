// The completion dialog's leaderboard opt-in: posting from the button and from
// Enter in the name field, and the guards that keep an invalid name or an IME
// composition from posting.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CompletionDialog from "./CompletionDialog";

function renderDialog(onPost = vi.fn().mockResolvedValue(undefined)) {
  render(
    <CompletionDialog
      difficulty="easy"
      elapsedMs={90_000}
      isSignedIn={false}
      onOpenChange={() => {}}
      onPost={onPost}
      open
      puzzleTitle="The Wedding Mini"
    />,
  );
  return { onPost, field: screen.getByLabelText("Display name") };
}

describe("CompletionDialog", () => {
  it("posts the trimmed name when Enter is pressed in the name field", async () => {
    const { onPost, field } = renderDialog();

    fireEvent.change(field, { target: { value: "  Robin  " } });
    fireEvent.keyDown(field, { key: "Enter" });

    await waitFor(() => expect(onPost).toHaveBeenCalledWith("Robin"));
  });

  it("does not post on Enter with a blank name", () => {
    const { onPost, field } = renderDialog();

    fireEvent.change(field, { target: { value: "   " } });
    fireEvent.keyDown(field, { key: "Enter" });

    expect(onPost).not.toHaveBeenCalled();
  });

  it("ignores the Enter that confirms an IME composition", () => {
    const { onPost, field } = renderDialog();

    fireEvent.change(field, { target: { value: "Robin" } });
    fireEvent.keyDown(field, { key: "Enter", isComposing: true });

    expect(onPost).not.toHaveBeenCalled();
  });

  it("still posts from the button", async () => {
    const { onPost, field } = renderDialog();

    fireEvent.change(field, { target: { value: "Robin" } });
    fireEvent.click(screen.getByRole("button", { name: "Post my time" }));

    await waitFor(() => expect(onPost).toHaveBeenCalledWith("Robin"));
  });
});
