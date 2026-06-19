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

    // Paging to the uncaptioned photo drops the caption.
    await user.keyboard("{ArrowRight}");
    expect(
      within(dialog).queryByText("The day we got engaged"),
    ).not.toBeInTheDocument();
  });
});
