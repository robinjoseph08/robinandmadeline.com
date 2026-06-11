import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { InfoStatusBadge } from "@/components/pages/admin/parties/InfoStatusBadge";
import { TooltipProvider } from "@/components/ui/tooltip";

function renderBadge(ui: React.ReactElement) {
  // The admin shell provides the TooltipProvider; mirror it here with no
  // delay so the hover assertions don't race the open timer.
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe("InfoStatusBadge", () => {
  it("shows Completed for a complete party, regardless of requested", () => {
    renderBadge(<InfoStatusBadge requested={false} status="complete" />);
    expect(screen.getByText("Completed")).toBeInTheDocument();

    renderBadge(<InfoStatusBadge requested status="complete" />);
    expect(screen.getAllByText("Completed")).toHaveLength(2);
    expect(screen.queryByText("Requested")).not.toBeInTheDocument();
  });

  it("shows Requested with the same missing-fields tooltip", async () => {
    const user = userEvent.setup();
    renderBadge(
      <InfoStatusBadge
        missingRequiredFields={["primary guest's email"]}
        requested
        status="incomplete"
      />,
    );
    const badge = screen.getByText("Requested");
    expect(screen.queryByText("Incomplete")).not.toBeInTheDocument();

    await user.hover(badge);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Missing: primary guest's email");
  });

  it("says No missing fields on a Requested party whose data is all present", async () => {
    // A requested party can have every field on file and still be waiting on
    // the guest: the link was sent to verify the data, not to collect it.
    const user = userEvent.setup();
    renderBadge(
      <InfoStatusBadge
        missingRequiredFields={[]}
        requested
        status="incomplete"
      />,
    );

    await user.hover(screen.getByText("Requested"));
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("No missing fields");
  });

  it("shows Incomplete with a hover tooltip listing the missing fields", async () => {
    const user = userEvent.setup();
    renderBadge(
      <InfoStatusBadge
        missingRequiredFields={["primary guest's email", "city", "country"]}
        requested={false}
        status="incomplete"
      />,
    );

    const badge = screen.getByText("Incomplete");
    expect(badge).toBeInTheDocument();
    // Focusable (but skipped by the grid's Enter traversal) so keyboard users
    // can reach the tooltip, which is the only place the list surfaces.
    expect(badge).toHaveAttribute("tabindex", "0");
    expect(badge).toHaveAttribute("data-grid-nav-skip");

    await user.hover(badge);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent(
      "Missing: primary guest's email, city, country",
    );
  });
});
