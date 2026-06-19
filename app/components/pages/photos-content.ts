/**
 * Curated gallery content for the public Photos page.
 *
 * The image assets are pre-generated and committed under app/assets/gallery by
 * scripts/build-gallery-photos.sh (metadata stripped, resized, AVIF + a JPEG
 * fallback). This module pairs those fingerprinted URLs with each photo's
 * intrinsic dimensions and display order so the gallery can lay itself out
 * (justified rows) and reserve space before the images load.
 *
 * To change which photos appear or their order, edit CURATED in the build
 * script, re-run it, and update GALLERY_MANIFEST below to match.
 */

/**
 * Fixed widths (px) of the small AVIF tiles used in the grid. The large lightbox
 * tile (mr-<slug>-lg.avif) caps its LONG edge at 2048 instead, so its width
 * varies by orientation and comes from the manifest (see GALLERY_MANIFEST).
 */
const AVIF_THUMB_WIDTHS = [480, 960] as const;

/**
 * Every generated gallery asset as a build-fingerprinted URL. Vite resolves this
 * glob at build time: keys are the on-disk paths, values the hashed URLs to put
 * in src/srcset. Eager so the map is a plain object, available synchronously.
 */
const assetUrls = import.meta.glob<string>(
  "../../assets/gallery/*.{avif,jpg}",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
);

// Index the URLs by bare filename ("mr-8-960.avif") for lookup by slug + width.
const urlByFile = new Map<string, string>(
  Object.entries(assetUrls).map(([path, url]) => [
    path.slice(path.lastIndexOf("/") + 1),
    url,
  ]),
);

const urlFor = (file: string): string => urlByFile.get(file) ?? "";

interface GalleryManifestEntry {
  /** Asset basename stem, e.g. "mr-8" -> mr-8-480.avif, mr-8-lg.avif. */
  slug: string;
  /** Dimensions of the large (-lg) variant, for aspect ratio and the srcset. */
  width: number;
  height: number;
}

/**
 * The curated photos, in display order, with the dimensions of each one's large
 * (-lg) variant. Generated from the committed assets; keep in sync with CURATED
 * in scripts/build-gallery-photos.sh.
 */
const GALLERY_MANIFEST: GalleryManifestEntry[] = [
  { slug: "mr-8", width: 1365, height: 2048 },
  { slug: "mr-9", width: 1365, height: 2048 },
  { slug: "mr-10", width: 1365, height: 2048 },
  { slug: "mr-11", width: 1365, height: 2048 },
  { slug: "mr-19", width: 2048, height: 1365 },
  { slug: "mr-25", width: 2048, height: 1365 },
  { slug: "mr-34", width: 1365, height: 2048 },
  { slug: "mr-40", width: 2048, height: 1365 },
  { slug: "mr-41", width: 1365, height: 2048 },
  { slug: "mr-43", width: 2048, height: 1365 },
  { slug: "mr-47", width: 1365, height: 2048 },
  { slug: "mr-49", width: 2048, height: 1365 },
  { slug: "mr-50", width: 2048, height: 1365 },
  { slug: "mr-53", width: 2048, height: 1365 },
  { slug: "mr-57", width: 2048, height: 1365 },
  { slug: "mr-59", width: 1365, height: 2048 },
  { slug: "mr-60", width: 1365, height: 2048 },
  { slug: "mr-62", width: 2048, height: 1365 },
  { slug: "mr-90", width: 2048, height: 1365 },
  { slug: "mr-91", width: 2048, height: 1365 },
  { slug: "mr-92", width: 2048, height: 1365 },
  { slug: "mr-94", width: 1365, height: 2048 },
  { slug: "mr-95", width: 2048, height: 1365 },
  { slug: "mr-96", width: 1365, height: 2048 },
  { slug: "mr-100", width: 1365, height: 2048 },
  { slug: "mr-101", width: 2048, height: 1365 },
  { slug: "mr-103", width: 1365, height: 2048 },
  { slug: "mr-105", width: 2048, height: 1365 },
  { slug: "mr-107", width: 2048, height: 1365 },
  { slug: "mr-108", width: 2048, height: 1365 },
  { slug: "mr-109", width: 2048, height: 1365 },
  { slug: "mr-113", width: 1365, height: 2048 },
  { slug: "mr-114", width: 2048, height: 1365 },
  { slug: "mr-115", width: 1365, height: 2048 },
];

/**
 * Optional captions, keyed by photo slug. Add an entry to annotate that photo
 * in the lightbox; any photo without an entry simply shows no caption. Kept
 * separate from GALLERY_MANIFEST so regenerating the dimensions never disturbs
 * the hand-written captions.
 *
 * Example:
 *   ["mr-43", "The proposal, minutes after she said yes"],
 */
const CAPTIONS = new Map<string, string>([
  // ["mr-8", "Add a caption like this to annotate a photo"],
]);

export interface GalleryPhoto {
  /** Asset stem; also a stable React key. */
  slug: string;
  /** Alt text describing the photo, used as the image's accessible name. */
  alt: string;
  /** Optional annotation shown in the lightbox; only some photos have one. */
  caption?: string;
  /** Dimensions of the large variant; drives the justified layout + reserves space. */
  width: number;
  height: number;
  /** AVIF `srcset` spanning the width ladder; the browser picks by `sizes`. */
  avifSrcSet: string;
  /** JPEG fallback for browsers without AVIF support. */
  fallbackSrc: string;
}

/** Build the AVIF srcset: the fixed-width thumbnails plus the large variant. */
function avifSrcSet(entry: GalleryManifestEntry): string {
  const thumbs = AVIF_THUMB_WIDTHS.map(
    (w) => `${urlFor(`${entry.slug}-${w}.avif`)} ${w}w`,
  );
  return [...thumbs, `${urlFor(`${entry.slug}-lg.avif`)} ${entry.width}w`].join(
    ", ",
  );
}

/** The gallery, in display order, ready to render. */
export const GALLERY_PHOTOS: GalleryPhoto[] = GALLERY_MANIFEST.map(
  (entry, index) => ({
    slug: entry.slug,
    alt: `Robin and Madeline engagement photo ${index + 1}`,
    caption: CAPTIONS.get(entry.slug),
    width: entry.width,
    height: entry.height,
    avifSrcSet: avifSrcSet(entry),
    fallbackSrc: urlFor(`${entry.slug}-1024.jpg`),
  }),
);
