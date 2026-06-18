import heroAvif640 from "@/assets/home-hero-640.avif";
import heroWebp640 from "@/assets/home-hero-640.webp";
import heroAvif1280 from "@/assets/home-hero-1280.avif";
import heroWebp1280 from "@/assets/home-hero-1280.webp";
import heroAvif1920 from "@/assets/home-hero-1920.avif";
import heroJpg1920 from "@/assets/home-hero-1920.jpg";
import heroWebp1920 from "@/assets/home-hero-1920.webp";
import heroAvif2560 from "@/assets/home-hero-2560.avif";
import heroWebp2560 from "@/assets/home-hero-2560.webp";
import heroAvif3840 from "@/assets/home-hero-3840.avif";
import heroWebp3840 from "@/assets/home-hero-3840.webp";

/** Hardcoded copy for the home page hero. */
export const WEDDING = {
  partnerOne: "Robin",
  partnerTwo: "Madeline",
  tagline: "We're getting married",
  dateText: "April 10, 2027",
  venueText: "Arrowwood · Palmer, TX",
};

/**
 * Responsive variants of the engagement photo shown in the home hero.
 *
 * Pre-generated from the photographer's 6000x4000 original (full frame, no
 * crop) with all metadata stripped. The width ladder spans small phones up to
 * a full-bleed 4K hero so the final site design, still to be determined, can
 * render the photo at any size without needing new assets. To regenerate
 * (ImageMagick, cwebp, avifenc), for each width W in 640/1280/1920/2560/3840:
 *
 *   magick original.jpg -auto-orient -strip -resize "${W}x" tmp-${W}.png
 *   cwebp -q 78 -m 6 -metadata none tmp-${W}.png -o home-hero-${W}.webp
 *   avifenc -q 60 -s 6 tmp-${W}.png home-hero-${W}.avif
 *
 * plus a single JPEG fallback for browsers with neither AVIF nor WebP:
 *
 *   magick original.jpg -auto-orient -strip -resize 1920x -quality 80 \
 *     -interlace JPEG home-hero-1920.jpg
 */
export const HERO_IMAGE = {
  alt: "Robin and Madeline laughing arm in arm in a field at golden hour",
  avifSrcSet: [
    `${heroAvif640} 640w`,
    `${heroAvif1280} 1280w`,
    `${heroAvif1920} 1920w`,
    `${heroAvif2560} 2560w`,
    `${heroAvif3840} 3840w`,
  ].join(", "),
  webpSrcSet: [
    `${heroWebp640} 640w`,
    `${heroWebp1280} 1280w`,
    `${heroWebp1920} 1920w`,
    `${heroWebp2560} 2560w`,
    `${heroWebp3840} 3840w`,
  ].join(", "),
  fallbackSrc: heroJpg1920,
  /** Intrinsic dimensions of the fallback; reserve layout space pre-load. */
  width: 1920,
  height: 1280,
};
