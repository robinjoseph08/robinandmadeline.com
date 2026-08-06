import { Outlet, useLocation } from "react-router-dom";

import BackgroundPattern from "@/components/library/BackgroundPattern";
import { PUZZLES_BY_SLUG } from "@/components/library/crossword/puzzles";
import SiteFooter from "@/components/library/SiteFooter";
import SiteHeader from "@/components/library/SiteHeader";

/**
 * App shell: the site header, the routed page content in a centered reading
 * column, and the shared footer, over a faint floral background that scrolls
 * with the page.
 */
export default function Root() {
  const { pathname } = useLocation();
  const encodedPuzzleSlug = pathname.match(/^\/games\/([^/]+)\/?$/i)?.[1];
  let puzzleSlug = encodedPuzzleSlug;
  if (encodedPuzzleSlug) {
    try {
      puzzleSlug = decodeURIComponent(encodedPuzzleSlug);
    } catch {
      // Keep malformed path segments unrecognized so they retain the footer.
    }
  }
  const isPuzzlePage = Boolean(
    puzzleSlug &&
    Object.prototype.hasOwnProperty.call(PUZZLES_BY_SLUG, puzzleSlug),
  );

  return (
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-background text-foreground">
      <BackgroundPattern />
      <SiteHeader />
      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-4">
        <Outlet />
      </main>
      {!isPuzzlePage && <SiteFooter />}
    </div>
  );
}
