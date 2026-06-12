export interface GalleryPhoto {
  /** Accessible name for the tile and the lightbox title. */
  label: string;
  /** Tailwind background utility from the wedding palette. */
  colorClass: string;
  /** Tailwind aspect-ratio utility, varied to give the grid a masonry feel. */
  aspectClass: string;
}

/**
 * The curated gallery, in display order. Every entry is a colored placeholder
 * block today; when real photos arrive, swap these for image sources (and keep
 * the labels as alt text).
 */
export const GALLERY_PHOTOS: GalleryPhoto[] = [
  {
    label: "Placeholder photo 1",
    colorClass: "bg-primary",
    aspectClass: "aspect-[3/4]",
  },
  {
    label: "Placeholder photo 2",
    colorClass: "bg-secondary",
    aspectClass: "aspect-square",
  },
  {
    label: "Placeholder photo 3",
    colorClass: "bg-complementary-1",
    aspectClass: "aspect-[4/3]",
  },
  {
    label: "Placeholder photo 4",
    colorClass: "bg-secondary",
    aspectClass: "aspect-[4/5]",
  },
  {
    label: "Placeholder photo 5",
    colorClass: "bg-complementary-1",
    aspectClass: "aspect-[3/4]",
  },
  {
    label: "Placeholder photo 6",
    colorClass: "bg-primary",
    aspectClass: "aspect-square",
  },
  {
    label: "Placeholder photo 7",
    colorClass: "bg-complementary-1",
    aspectClass: "aspect-[4/5]",
  },
  {
    label: "Placeholder photo 8",
    colorClass: "bg-primary",
    aspectClass: "aspect-[4/3]",
  },
  {
    label: "Placeholder photo 9",
    colorClass: "bg-secondary",
    aspectClass: "aspect-[3/4]",
  },
];
