import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import Photos from "@/components/pages/Photos";
import { GALLERY_PHOTOS } from "@/components/pages/photos-content";

/** Open the lightbox by clicking the tile at `index`, returning the dialog. */
async function openLightbox(
  user: ReturnType<typeof userEvent.setup>,
  index = 0,
) {
  // A tile's accessible name mirrors the component: caption when present, else alt.
  const photo = GALLERY_PHOTOS[index];
  await user.click(
    screen.getByRole("button", {
      name: `View ${photo.caption ?? photo.alt}`,
    }),
  );
  return screen.getByRole("dialog");
}

describe("Photos", () => {
  it("renders the page heading and subtitle", () => {
    render(<Photos />);

    expect(
      screen.getByRole("heading", { name: /photos/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("A few of our favorite moments together."),
    ).toBeInTheDocument();
  });

  it("renders exactly one gallery tile per photo", () => {
    render(<Photos />);

    expect(screen.getAllByRole("button", { name: /^view /i })).toHaveLength(
      GALLERY_PHOTOS.length,
    );
  });

  it("opens the lightbox on the clicked photo", async () => {
    const user = userEvent.setup();
    render(<Photos />);

    const dialog = await openLightbox(user, 2);
    expect(
      within(dialog).getByAltText(GALLERY_PHOTOS[2].alt),
    ).toBeInTheDocument();
  });

  it("pages forward with the next button and the right arrow key", async () => {
    const user = userEvent.setup();
    render(<Photos />);

    const dialog = await openLightbox(user, 0);

    await user.click(
      within(dialog).getByRole("button", { name: /next photo/i }),
    );
    expect(
      within(dialog).getByAltText(GALLERY_PHOTOS[1].alt),
    ).toBeInTheDocument();

    await user.keyboard("{ArrowRight}");
    expect(
      within(dialog).getByAltText(GALLERY_PHOTOS[2].alt),
    ).toBeInTheDocument();
  });

  it("pages backward and wraps around from the first photo", async () => {
    const user = userEvent.setup();
    render(<Photos />);

    const dialog = await openLightbox(user, 0);

    await user.keyboard("{ArrowLeft}");
    const last = GALLERY_PHOTOS[GALLERY_PHOTOS.length - 1];
    expect(within(dialog).getByAltText(last.alt)).toBeInTheDocument();
  });

  it("closes the lightbox with the close button", async () => {
    const user = userEvent.setup();
    render(<Photos />);

    await openLightbox(user, 0);
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the lightbox with the Escape key", async () => {
    const user = userEvent.setup();
    render(<Photos />);

    await openLightbox(user, 0);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
