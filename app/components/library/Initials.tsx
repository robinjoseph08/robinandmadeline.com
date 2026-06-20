import { WEDDING } from "@/components/pages/home-content";
import { cn } from "@/libraries/utils";

interface InitialsProps {
  /** Color, shadow, and visibility classes for the context it sits in. */
  className?: string;
}

/**
 * The couple's initials, "R&M", in the Magics Flavor display face. This is the
 * compact brand mark for the header bars and the mobile menu, where the full
 * script names (Names) don't fit; the ampersand is sized down so it reads as a
 * connecting flourish rather than a third letter. Initials are derived from the
 * same source as Names so the two never drift.
 */
export default function Initials({ className }: InitialsProps) {
  return (
    <span
      className={cn(
        "font-display text-lg font-normal tracking-wide",
        className,
      )}
    >
      {WEDDING.partnerOne[0]}
      <span className="px-0.5 text-[0.85em]">&amp;</span>
      {WEDDING.partnerTwo[0]}
    </span>
  );
}
