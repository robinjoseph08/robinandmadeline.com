import { cn } from "@/libraries/utils";

import { chipColorClass } from "./chips";

// The base pill look shared by every chip (grid chip cells, comboboxes, and the
// read-only attribute columns), so a value reads identically everywhere.
export const CHIP_CLASS =
  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium";

/**
 * A colored pill. The color is derived from `colorKey`, which defaults to the
 * label, so a value whose label differs from its wire value can color and label
 * independently: a party's side shows "Robin"/"Madeline" but colors by
 * "robin"/"madeline".
 */
export function Chip({
  label,
  colorKey,
  className,
}: {
  label: string;
  colorKey?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(CHIP_CLASS, chipColorClass(colorKey ?? label), className)}
    >
      {label}
    </span>
  );
}
