import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Expand, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import PageHeader from "@/components/library/PageHeader";
import {
  GALLERY_PHOTOS,
  type GalleryPhoto,
} from "@/components/pages/photos-content";

/** Gap between tiles, in px; matches the `gap-3` utility on the rows. */
const GAP = 12;

/**
 * `sizes` hints. Grid tiles never render much wider than ~360px, so the browser
 * pulls a 480/960 AVIF for them; the lightbox spans the viewport and pulls the
 * 2048 AVIF.
 */
const GRID_SIZES = "(max-width: 639px) 45vw, (max-width: 1023px) 30vw, 320px";
const LIGHTBOX_SIZES = "(max-width: 640px) 92vw, 88vw";

/** Target row height (px) for the justified grid, scaled down on small screens. */
function targetRowHeight(containerWidth: number): number {
  if (containerWidth < 480) return 160;
  if (containerWidth < 768) return 200;
  return 264;
}

interface LayoutBox {
  photo: GalleryPhoto;
  /** Index into GALLERY_PHOTOS, so a tile can open the right lightbox slide. */
  index: number;
  width: number;
  height: number;
}

/**
 * Pack the photos into justified rows (à la Flickr/Google Photos): greedily fill
 * a row until scaling it to the container width would drop below the target
 * height, then commit it at exactly the container width. The final, short row is
 * left at the target height rather than blown up to fill the width.
 */
function buildRows(
  photos: GalleryPhoto[],
  containerWidth: number,
): LayoutBox[][] {
  const target = targetRowHeight(containerWidth);
  const rows: LayoutBox[][] = [];
  let current: { photo: GalleryPhoto; index: number }[] = [];
  let aspectSum = 0;

  const commit = (isLast: boolean) => {
    if (current.length === 0) return;
    const totalGap = GAP * (current.length - 1);
    const fittedHeight = (containerWidth - totalGap) / aspectSum;
    const height = isLast ? Math.min(fittedHeight, target) : fittedHeight;
    rows.push(
      current.map(({ photo, index }) => ({
        photo,
        index,
        width: Math.round((photo.width / photo.height) * height),
        height: Math.round(height),
      })),
    );
    current = [];
    aspectSum = 0;
  };

  photos.forEach((photo, index) => {
    current.push({ photo, index });
    aspectSum += photo.width / photo.height;
    const totalGap = GAP * (current.length - 1);
    const fittedHeight = (containerWidth - totalGap) / aspectSum;
    if (fittedHeight <= target) commit(false);
  });
  commit(true);

  return rows;
}

/**
 * Photo gallery: a justified grid of the couple's photos. Clicking a tile opens
 * a full-screen lightbox with previous/next controls, arrow-key navigation, and
 * click-outside / Escape to close.
 */
export default function Photos() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const count = GALLERY_PHOTOS.length;

  // Track the grid's content width so the justified layout reflows on resize.
  // Falls back to a sensible width until measured (e.g. in jsdom, where layout
  // is not computed) so every tile still renders.
  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => setContainerWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const openAt = useCallback((target: number) => {
    setIndex(target);
    setOpen(true);
  }, []);
  const showNext = useCallback(() => setIndex((i) => (i + 1) % count), [count]);
  const showPrev = useCallback(
    () => setIndex((i) => (i - 1 + count) % count),
    [count],
  );

  // Arrow keys page through the lightbox while it is open (Radix owns Escape).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        showNext();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        showPrev();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, showNext, showPrev]);

  // Warm the next/previous full-size images so navigation feels instant.
  useEffect(() => {
    if (!open) return;
    for (const neighbor of [(index + 1) % count, (index - 1 + count) % count]) {
      const photo = GALLERY_PHOTOS[neighbor];
      const image = new Image();
      image.sizes = LIGHTBOX_SIZES;
      image.srcset = photo.avifSrcSet;
      image.src = photo.fallbackSrc;
    }
  }, [open, index, count]);

  const rows = useMemo(
    () => buildRows(GALLERY_PHOTOS, containerWidth || 1024),
    [containerWidth],
  );

  const active = GALLERY_PHOTOS[index];

  return (
    <div className="py-12">
      <PageHeader
        subtitle="A few of our favorite moments together."
        title="Photos"
      />

      <div className="mt-10 flex flex-col gap-3" ref={containerRef}>
        {rows.map((row) => (
          <div className="flex flex-nowrap gap-3" key={row[0].index}>
            {row.map((box) => (
              <button
                aria-label={`View ${box.photo.caption ?? box.photo.alt}`}
                className="group relative shrink-0 cursor-pointer overflow-hidden rounded-xl bg-line/50 shadow-sm ring-rose/70 transition-shadow duration-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2"
                key={box.photo.slug}
                onClick={() => openAt(box.index)}
                style={{ height: box.height, width: box.width }}
                type="button"
              >
                <picture>
                  <source
                    sizes={GRID_SIZES}
                    srcSet={box.photo.avifSrcSet}
                    type="image/avif"
                  />
                  <img
                    alt={box.photo.alt}
                    className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.05]"
                    decoding="async"
                    height={box.height}
                    loading="lazy"
                    src={box.photo.fallbackSrc}
                    width={box.width}
                  />
                </picture>
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 flex items-center justify-center bg-ink/0 opacity-0 transition duration-300 group-hover:bg-ink/20 group-hover:opacity-100"
                >
                  <Expand className="size-6 text-white drop-shadow-md" />
                </span>
                {box.photo.caption ? (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-ink/85 via-ink/40 to-transparent px-3 pb-2 pt-8 text-left text-sm font-medium text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100"
                  >
                    {box.photo.caption}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ))}
      </div>

      <DialogPrimitive.Root onOpenChange={setOpen} open={open}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/90 backdrop-blur-sm data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed inset-0 z-50 flex items-center justify-center p-4 focus:outline-none data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
            <DialogPrimitive.Title className="sr-only">
              {active.alt}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Photo {index + 1} of {count}. Use the arrow keys or the on-screen
              buttons to move between photos.
            </DialogPrimitive.Description>

            {/* Clicking the dark area closes; the image and controls sit above. */}
            <button
              aria-label="Close photo viewer"
              className="absolute inset-0 cursor-zoom-out"
              onClick={() => setOpen(false)}
              tabIndex={-1}
              type="button"
            />

            <button
              aria-label="Previous photo"
              className="absolute left-2 top-1/2 z-20 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink/40 text-white backdrop-blur transition hover:bg-ink/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:left-4"
              onClick={showPrev}
              type="button"
            >
              <ChevronLeft aria-hidden className="size-6" />
            </button>

            <figure className="relative z-10 m-0 flex max-h-full max-w-full flex-col items-center gap-4">
              <picture>
                <source
                  sizes={LIGHTBOX_SIZES}
                  srcSet={active.avifSrcSet}
                  type="image/avif"
                />
                <img
                  alt={active.alt}
                  className="max-h-[80vh] w-auto max-w-[92vw] rounded-lg object-contain shadow-2xl"
                  decoding="async"
                  height={active.height}
                  src={active.fallbackSrc}
                  width={active.width}
                />
              </picture>
              <figcaption className="flex max-w-2xl flex-col items-center gap-2 px-2 text-center">
                {active.caption ? (
                  <span className="text-base text-white/95 sm:text-lg">
                    {active.caption}
                  </span>
                ) : null}
                <span className="text-xs font-medium uppercase tracking-wider text-white/60">
                  {index + 1} / {count}
                </span>
              </figcaption>
            </figure>

            <button
              aria-label="Next photo"
              className="absolute right-2 top-1/2 z-20 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-ink/40 text-white backdrop-blur transition hover:bg-ink/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 sm:right-4"
              onClick={showNext}
              type="button"
            >
              <ChevronRight aria-hidden className="size-6" />
            </button>

            <DialogPrimitive.Close
              aria-label="Close"
              className="absolute right-3 top-3 z-20 flex size-10 items-center justify-center rounded-full bg-ink/40 text-white backdrop-blur transition hover:bg-ink/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            >
              <X aria-hidden className="size-5" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
}
