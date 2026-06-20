import { useCallback, useState } from "react";

import {
  parseSortSpec,
  serializeSortSpec,
  type SortLevel,
} from "@/libraries/sortSpec";

/**
 * A per-list default sort persisted in localStorage (so it is per-browser, not
 * shared or server-side). Returns the stored default (parsed, or null when none
 * is saved or the stored value is no longer valid) and a setter that writes the
 * new default through. Saving an empty spec clears the stored default so the list
 * falls back to its builtin.
 *
 * validFields should be a stable (module-level) set of the list's sortable field
 * tokens; the stored value is re-validated against it on read so a default saved
 * before a field was removed degrades gracefully instead of throwing.
 */
export function useSortDefault(
  storageKey: string,
  validFields: ReadonlySet<string>,
): [SortLevel[] | null, (levels: readonly SortLevel[]) => void] {
  const [stored, setStored] = useState<SortLevel[] | null>(() =>
    readStoredSort(storageKey, validFields),
  );

  const save = useCallback(
    (levels: readonly SortLevel[]) => {
      const serialized = serializeSortSpec(levels);
      try {
        if (serialized) localStorage.setItem(storageKey, serialized);
        else localStorage.removeItem(storageKey);
      } catch {
        // Storage can fail (private mode, quota); the default just won't persist.
      }
      setStored(levels.length > 0 ? [...levels] : null);
    },
    [storageKey],
  );

  return [stored, save];
}

function readStoredSort(
  storageKey: string,
  validFields: ReadonlySet<string>,
): SortLevel[] | null {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? parseSortSpec(raw, validFields) : null;
  } catch {
    return null;
  }
}
