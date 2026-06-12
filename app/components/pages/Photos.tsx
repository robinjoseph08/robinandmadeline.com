import { Image as ImageIcon } from "lucide-react";
import { useState } from "react";

import PageHeader from "@/components/library/PageHeader";
import {
  GALLERY_PHOTOS,
  type GalleryPhoto,
} from "@/components/pages/photos-content";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/libraries/utils";

/**
 * Photo gallery: a masonry-style grid of placeholder tiles. Clicking a tile
 * opens a lightbox dialog with the full-size view (also a placeholder until
 * real photos land in the content file).
 */
export default function Photos() {
  // `open` is tracked separately from `active` so the lightbox keeps showing
  // the last-clicked photo while the close animation plays out; clearing
  // `active` on close would blank the dialog mid-exit.
  const [active, setActive] = useState<GalleryPhoto | null>(null);
  const [open, setOpen] = useState(false);

  return (
    <div className="py-12">
      <PageHeader
        subtitle="A gallery of our favorite moments. Real photos are coming soon."
        title="Photos"
      />

      <div className="mt-10 columns-2 gap-4 sm:columns-3">
        {GALLERY_PHOTOS.map((photo) => (
          <button
            aria-label={`View ${photo.label}`}
            className={cn(
              "mb-4 flex w-full cursor-pointer break-inside-avoid items-center justify-center rounded-xl transition-opacity hover:opacity-80",
              photo.colorClass,
              photo.aspectClass,
            )}
            key={photo.label}
            onClick={() => {
              setActive(photo);
              setOpen(true);
            }}
            type="button"
          >
            <ImageIcon aria-hidden className="size-6 text-ink/30" />
          </button>
        ))}
      </div>

      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{active?.label}</DialogTitle>
            <DialogDescription>
              The full-size photo will appear here once the gallery is ready.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-6">
            <div
              className={cn(
                "flex aspect-[4/3] w-full items-center justify-center rounded-lg",
                active?.colorClass,
              )}
            >
              <ImageIcon aria-hidden className="size-10 text-ink/30" />
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>
    </div>
  );
}
