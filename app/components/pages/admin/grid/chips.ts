/**
 * Deterministic chip colors for the circle and tag cells. Each value hashes to a
 * fixed entry in a curated soft palette, so a given circle or tag always reads in
 * the same color across every row and inside the dropdown. The classes are
 * literal strings so Tailwind's scanner keeps them.
 */

const CHIP_COLORS = [
  "bg-rose-200 text-rose-900",
  "bg-orange-200 text-orange-900",
  "bg-amber-200 text-amber-900",
  "bg-yellow-200 text-yellow-900",
  "bg-lime-200 text-lime-900",
  "bg-emerald-200 text-emerald-900",
  "bg-teal-200 text-teal-900",
  "bg-cyan-200 text-cyan-900",
  "bg-sky-200 text-sky-900",
  "bg-blue-200 text-blue-900",
  "bg-indigo-200 text-indigo-900",
  "bg-violet-200 text-violet-900",
  "bg-purple-200 text-purple-900",
  "bg-fuchsia-200 text-fuchsia-900",
  "bg-pink-200 text-pink-900",
  "bg-stone-200 text-stone-900",
] as const;

/** Returns a stable `bg-* text-*` class pair for a chip value. */
export function chipColorClass(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return CHIP_COLORS[hash % CHIP_COLORS.length];
}
