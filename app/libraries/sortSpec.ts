/**
 * Parses, validates, and serializes the admin lists' multi-level sort specs
 * (e.g. "side:asc,name:asc"). Mirrors pkg/sortspec (Go): keep the grammar in
 * sync. Which field tokens are valid is a per-list concern, so the caller passes
 * the allowed set (PARTY_SORT_FIELDS / GUEST_SORT_FIELDS in the admin options).
 */

export type SortDirection = "asc" | "desc";

export interface SortLevel {
  field: string;
  direction: SortDirection;
}

/** Hard cap matching pkg/sortspec.MaxLevels. */
export const MAX_SORT_LEVELS = 8;

function isSortDirection(s: string): s is SortDirection {
  return s === "asc" || s === "desc";
}

/**
 * Parse a serialized sort spec against the given valid-field set. Returns null
 * for any invalid input (unknown field, bad direction, duplicate, empty pair,
 * whitespace, too many levels); callers treat null as "no sort" and fall back to
 * their default. Mirrors sortspec.Parse in Go (which errors where this returns
 * null).
 */
export function parseSortSpec(
  s: string,
  validFields: ReadonlySet<string>,
): SortLevel[] | null {
  if (!s) return null;
  if (/\s/.test(s)) return null;

  const parts = s.split(",");
  if (parts.length > MAX_SORT_LEVELS) return null;

  const levels: SortLevel[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    if (!part) return null;
    // Unbounded split + length check so trailing junk ("name:asc:extra")
    // rejects instead of being silently truncated, mirroring Go's SplitN(_, 2)
    // plus direction validation.
    const pieces = part.split(":");
    if (pieces.length !== 2) return null;
    const [field, direction] = pieces;
    if (!field || !direction) return null;
    if (!validFields.has(field)) return null;
    if (!isSortDirection(direction)) return null;
    if (seen.has(field)) return null;
    seen.add(field);
    levels.push({ field, direction });
  }

  return levels;
}

/**
 * Serialize a spec back into the URL-param form. Returns "" for an empty array;
 * callers treat empty output as "no sort" and omit the param.
 */
export function serializeSortSpec(levels: readonly SortLevel[]): string {
  return levels.map((l) => `${l.field}:${l.direction}`).join(",");
}

/** Deep equality for two specs (order matters). */
export function sortSpecsEqual(
  a: readonly SortLevel[] | null | undefined,
  b: readonly SortLevel[] | null | undefined,
): boolean {
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  return a.every(
    (l, i) => l.field === b[i].field && l.direction === b[i].direction,
  );
}
