import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import Photos from "@/components/pages/Photos";
import { GALLERY_PHOTOS } from "@/components/pages/photos-content";

describe("Photos", () => {
  it("renders the page heading", () => {
    render(<Photos />);

    expect(
      screen.getByRole("heading", { name: /photos/i }),
    ).toBeInTheDocument();
  });

  it("renders a gallery tile for every photo", () => {
    render(<Photos />);

    for (const photo of GALLERY_PHOTOS) {
      expect(
        screen.getByRole("button", { name: `View ${photo.label}` }),
      ).toBeInTheDocument();
    }
  });

  it("opens the lightbox for the clicked photo", async () => {
    const user = userEvent.setup();
    render(<Photos />);

    const photo = GALLERY_PHOTOS[1];
    await user.click(
      screen.getByRole("button", { name: `View ${photo.label}` }),
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: photo.label }),
    ).toBeInTheDocument();
  });

  it("closes the lightbox via the close button", async () => {
    const user = userEvent.setup();
    render(<Photos />);

    await user.click(
      screen.getByRole("button", { name: `View ${GALLERY_PHOTOS[0].label}` }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /close/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the lightbox with the Escape key", async () => {
    const user = userEvent.setup();
    render(<Photos />);

    await user.click(
      screen.getByRole("button", { name: `View ${GALLERY_PHOTOS[0].label}` }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
