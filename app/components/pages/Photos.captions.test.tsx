import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import Photos from "@/components/pages/Photos";

// Mock the gallery data so caption behavior is exercised independently of which
// production photos happen to be annotated. vitest hoists vi.mock above imports.
vi.mock("@/components/pages/photos-content", () => ({
  GALLERY_PHOTOS: [
    {
      slug: "captioned",
      alt: "Engagement photo one",
      caption: "The day we got engaged",
      width: 1365,
      height: 2048,
      avifSrcSet: "captioned.avif 1365w",
      fallbackSrc: "captioned.jpg",
    },
    {
      slug: "plain",
      alt: "Engagement photo two",
      width: 2048,
      height: 1365,
      avifSrcSet: "plain.avif 2048w",
      fallbackSrc: "plain.jpg",
    },
  ],
}));

describe("Photos captions", () => {
  it("uses the caption as the tile's accessible name when present", () => {
    render(<Photos />);

    expect(
      screen.getByRole("button", { name: "View The day we got engaged" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View Engagement photo two" }),
    ).toBeInTheDocument();
  });

  it("shows the caption in the lightbox only for annotated photos", async () => {
    const user = userEvent.setup();
    render(<Photos />);

    await user.click(
      screen.getByRole("button", { name: "View The day we got engaged" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText("The day we got engaged"),
    ).toBeInTheDocument();

    // Paging to the uncaptioned photo drops the caption, and the alt text must
    // not leak in as a fallback caption.
    await user.keyboard("{ArrowRight}");
    expect(
      within(dialog).queryByText("The day we got engaged"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText("Engagement photo two"),
    ).not.toBeInTheDocument();
  });

  it("wires the AVIF srcset and JPEG fallback into the lightbox", async () => {
    const user = userEvent.setup();
    render(<Photos />);

    await user.click(
      screen.getByRole("button", { name: "View The day we got engaged" }),
    );
    const dialog = screen.getByRole("dialog");

    expect(within(dialog).getByAltText("Engagement photo one")).toHaveAttribute(
      "src",
      "captioned.jpg",
    );
    const source = dialog.querySelector('source[type="image/avif"]');
    expect(source).toHaveAttribute("srcset", "captioned.avif 1365w");
  });

  it("renders a truncating caption overlay only on captioned grid tiles", () => {
    render(<Photos />);

    // The captioned tile carries a single-line, truncating caption overlay.
    expect(screen.getByText("The day we got engaged")).toHaveClass("truncate");
    // The uncaptioned tile has no caption overlay text.
    expect(screen.queryByText("Engagement photo two")).not.toBeInTheDocument();
  });
});
