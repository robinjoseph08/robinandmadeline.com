import { useEffect } from "react";

const APP_NAME = "Robin & Madeline";
const SEPARATOR = " · ";

/**
 * Sets document.title to the given segments followed by the app name, joined by
 * a middot, and restores the previous title on unmount. Falsy segments are
 * dropped, so a still-loading detail title collapses to just the app name.
 */
function useDocumentTitle(segments: Array<string | undefined>): void {
  const title = [...segments, APP_NAME].filter(Boolean).join(SEPARATOR);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = title;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}

/**
 * Sets the browser tab title for a guest-facing page.
 *
 * @param title - The page-specific title. Pass undefined or an empty string
 *   (e.g. while a detail page's data is still loading, or for the home page) to
 *   show just the app name.
 *
 * @example
 * // "Schedule · Robin & Madeline"
 * usePageTitle("Schedule");
 *
 * @example
 * // "Robin & Madeline" while loading, then "<puzzle> · Robin & Madeline"
 * usePageTitle(puzzle?.title);
 *
 * @example
 * // just "Robin & Madeline"
 * usePageTitle();
 */
export function usePageTitle(title?: string): void {
  useDocumentTitle([title]);
}

/**
 * Sets the browser tab title for an admin (back-office) page, tagging it with an
 * "Admin" segment so admin tabs are distinguishable from guest-facing ones.
 *
 * @param title - The page-specific title, handled like {@link usePageTitle}.
 *
 * @example
 * // "Guests · Admin · Robin & Madeline"
 * useAdminPageTitle("Guests");
 *
 * @example
 * // "<party name> · Admin · Robin & Madeline"
 * useAdminPageTitle(party?.name);
 */
export function useAdminPageTitle(title?: string): void {
  useDocumentTitle([title, "Admin"]);
}
