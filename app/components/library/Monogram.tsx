import monogramWebp480 from "@/assets/monogram/monogram-480.webp";
import monogramPng720 from "@/assets/monogram/monogram-720.png";
import monogramWebp720 from "@/assets/monogram/monogram-720.webp";
import monogramWebp1080 from "@/assets/monogram/monogram-1080.webp";
import { cn } from "@/libraries/utils";

interface MonogramProps {
  className?: string;
  /** Browser sizing hint for srcset selection. */
  sizes?: string;
}

/**
 * The couple's floral wreath monogram (the "R&M" brand mark). Used full-strength
 * as a hero anchor or footer mark on the page background; never tinted, since
 * its watercolor hues are the source of the site palette.
 */
export default function Monogram({
  className,
  sizes = "160px",
}: MonogramProps) {
  return (
    <picture>
      <source
        sizes={sizes}
        srcSet={`${monogramWebp480} 480w, ${monogramWebp720} 720w, ${monogramWebp1080} 1080w`}
        type="image/webp"
      />
      <img
        alt="Robin and Madeline floral monogram"
        className={cn("select-none", className)}
        decoding="async"
        height={1190}
        loading="lazy"
        src={monogramPng720}
        width={1080}
      />
    </picture>
  );
}
