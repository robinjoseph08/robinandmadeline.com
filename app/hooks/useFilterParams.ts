import { useCallback, useEffect, useMemo, useRef } from "react";
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
 * they parse back to booleans. Multi-value filters (a chips combobox over
 * guest tags) are repeated params (?tags=a&tags=b); list their keys in
 * arrayKeys so they read back as a string[] and setFilter writes the whole set
 * (clearing the param when the array is empty). Every other value stays a plain
 * string.
 */
// T is the page's list-query type (e.g. ListGuestsQuery). It is an interface, so
// it is constrained to `object` rather than a Record (interfaces lack the index
// signature a Record constraint demands); the values are normalized through
// strings either way.
export function useFilterParams<T extends object>(
  keys: readonly (keyof T)[],
  boolKeys: readonly (keyof T)[] = [],
  arrayKeys: readonly (keyof T)[] = [],
) {
  const [searchParams, setSearchParams] = useSearchParams();
  // The writers below read the current params through this ref rather than
  // react-router's functional `setSearchParams((prev) => ...)`: that form
  // hands the callback the params captured when the callback's render
  // committed (react-router #9991), so a handler holding a stale closure
  // (e.g. a filter-sheet toggle racing the search box's debounced commit)
  // would write against outdated params and silently erase the other
  // writer's value. Each writer also writes its result back into the ref
  // synchronously, so two writes that land before React commits a render in
  // between (a debounce timer firing in the same task as a click handler,
  // which happens under CPU load) compose instead of the second erasing the
  // first. The effect re-syncs the ref on every committed render so external
  // navigations (back/forward, a Link) are picked up too.
  const searchParamsRef = useRef(searchParams);
  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);
  const boolSet = useMemo(
    () => new Set(boolKeys as readonly string[]),
    [boolKeys],
  );
  const arraySet = useMemo(
    () => new Set(arrayKeys as readonly string[]),
    [arrayKeys],
  );

  const filters = useMemo(() => {
    const out: Record<string, string | boolean | string[]> = {};
    for (const key of keys as readonly string[]) {
      if (arraySet.has(key)) {
        // Repeated params (?tags=a&tags=b) read back as a string[]; an absent
        // key stays undefined so it never constrains.
        const values = searchParams.getAll(key);
        if (values.length > 0) out[key] = values;
        continue;
      }
      const value = searchParams.get(key);
      if (value === null) continue;
      out[key] = boolSet.has(key) ? value === "true" : value;
    }
    return out as T;
  }, [searchParams, keys, boolSet, arraySet]);

  const setFilter = useCallback(
    <K extends keyof T>(key: K, value: T[K]) => {
      const next = new URLSearchParams(searchParamsRef.current);
      const name = key as string;
      if (arraySet.has(name)) {
        // Replace the whole set: drop the prior values, then add the new ones.
        // An empty (or missing) array clears the param entirely.
        next.delete(name);
        const values = (value ?? []) as readonly string[];
        for (const v of values) next.append(name, v);
      } else {
        // undefined / empty clears the param; everything else (including the
        // boolean false -> "false") is stored as a string.
        const serialized = value === undefined ? "" : String(value);
        if (serialized === "") {
          next.delete(name);
        } else {
          next.set(name, serialized);
        }
      }
      // Write the result back into the ref synchronously (and pass it to
      // react-router) so two writes landing before a render compose instead of
      // the second erasing the first; array writes take the same path.
      searchParamsRef.current = next;
      setSearchParams(next, { replace: true });
    },
    [setSearchParams, arraySet],
  );

  // Drop every filter at once (the sheet's "Clear all"), optionally keeping a few
  // params untouched (e.g. the search box, which lives outside the filter sheet).
  // Only the page's declared keys are removed: unknown params are not ours to
  // clear, so they stay in the URL just as the read side leaves them.
  const clearAll = useCallback(
    (keep: readonly (keyof T)[] = []) => {
      const next = new URLSearchParams(searchParamsRef.current);
      for (const key of keys) {
        if (!keep.includes(key)) next.delete(key as string);
      }
      searchParamsRef.current = next;
      setSearchParams(next, { replace: true });
    },
    [setSearchParams, keys],
  );

  return [filters, setFilter, clearAll] as const;
}
