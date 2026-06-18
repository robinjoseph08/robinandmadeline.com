import { WEDDING } from "@/components/pages/home-content";
import { cn } from "@/libraries/utils";

interface NamesProps {
  /** Sizing / color classes for the layout this instance sits in. */
  className?: string;
  /** Optional override for the ampersand. */
  ampersandClassName?: string;
}

/**
 * The couple's names, "Robin & Madeline", in the Lily Paperie script face. The
 * ampersand is sized down a touch so it reads as a connecting flourish rather
 * than a third word.
 */
export default function Names({ className, ampersandClassName }: NamesProps) {
  return (
    <span
      className={cn(
        "inline-block font-script font-normal leading-none",
        className,
      )}
    >
      {WEDDING.partnerOne}{" "}
      <span className={cn("text-[0.82em]", ampersandClassName)}>&amp;</span>{" "}
      {WEDDING.partnerTwo}
    </span>
  );
}
