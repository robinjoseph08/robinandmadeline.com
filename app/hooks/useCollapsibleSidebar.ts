import { useCallback, useState } from "react";

/** Where the admin sidebar's collapsed state persists (per browser, not shared). */
const STORAGE_KEY = "admin:sidebar:collapsed";

/**
 * The admin sidebar's collapsed/expanded state, persisted in localStorage so the
 * choice is remembered per browser across reloads. Returns the current state and
 * a toggle that writes the new value through. Defaults to expanded when nothing
 * is stored (or storage is unreadable, e.g. private mode).
 */
export function useCollapsibleSidebar(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState<boolean>(readStored);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
      } catch {
        // Storage can fail (private mode, quota); the choice just won't persist.
      }
      return next;
    });
  }, []);

  return [collapsed, toggle];
}

function readStored(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}
