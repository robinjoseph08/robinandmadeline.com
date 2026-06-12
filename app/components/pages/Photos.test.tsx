import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import Photos from "@/components/pages/Photos";
import { GALLERY_PHOTOS } from "@/components/pages/photos-content";

describe("Photos", () => {
  it("renders the page heading and subtitle", () => {
    render(<Photos />);

    expect(
      screen.getByRole("heading", { name: /photos/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "A gallery of our favorite moments. Real photos are coming soon.",
      ),
    ).toBeInTheDocument();
  });

  it("renders exactly one gallery tile per photo", () => {
    render(<Photos />);

    expect(screen.getAllByRole("button", { name: /^view /i })).toHaveLength(
      GALLERY_PHOTOS.length,
    );
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
