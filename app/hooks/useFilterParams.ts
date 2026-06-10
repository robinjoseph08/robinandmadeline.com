import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * URL-backed filter state for the admin list pages, mirroring shisho's
 * useSearchParams pattern (see its useResourceListState): the filters live in the
 * query string, so a filtered view can be shared and bookmarked and survives a
 * reload. Returns the filters parsed from the URL plus a setter that writes one
 * filter (or removes it when cleared back to undefined/empty).
 *
 * Only the page's declared keys are read back out (keys, a stable, module-level
 * array of the API query field names). Unknown params (a utm_ tag on a shared
 * link) may sit in the URL, but they must never reach the API: the binder 422s
 * unknown query keys, which would brick the list with no recovery.
 *
 * Query-string values are strings, so boolean filters are stored as
 * "true"/"false"; list their keys in boolKeys (also stable and module-level) so
 * they parse back to booleans. Every other value stays a plain string.
 */
// T is the page's list-query type (e.g. ListGuestsQuery). It is an interface, so
// it is constrained to `object` rather than a Record (interfaces lack the index
// signature a Record constraint demands); the values are normalized through
// strings either way.
export function useFilterParams<T extends object>(
  keys: readonly (keyof T)[],
  boolKeys: readonly (keyof T)[] = [],
) {
  const [searchParams, setSearchParams] = useSearchParams();
  const boolSet = useMemo(
    () => new Set(boolKeys as readonly string[]),
    [boolKeys],
  );

  const filters = useMemo(() => {
    const out: Record<string, string | boolean> = {};
    for (const key of keys as readonly string[]) {
      const value = searchParams.get(key);
      if (value === null) continue;
      out[key] = boolSet.has(key) ? value === "true" : value;
    }
    return out as T;
  }, [searchParams, keys, boolSet]);

  const setFilter = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          // undefined / empty clears the param; everything else (including the
          // boolean false -> "false") is stored as a string.
          const serialized = value === undefined ? "" : String(value);
          if (serialized === "") {
            next.delete(key as string);
          } else {
            next.set(key as string, serialized);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Drop every filter at once (the sheet's "Clear all"), optionally keeping a few
  // params untouched (e.g. the search box, which lives outside the filter sheet).
  const clearAll = useCallback(
    (keep: readonly (keyof T)[] = []) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams();
          for (const key of keep) {
            const value = prev.get(key as string);
            if (value) next.set(key as string, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return [filters, setFilter, clearAll] as const;
}
