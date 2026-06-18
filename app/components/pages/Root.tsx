import { Outlet } from "react-router-dom";

import BackgroundPattern from "@/components/library/BackgroundPattern";
import SiteFooter from "@/components/library/SiteFooter";
import SiteHeader from "@/components/library/SiteHeader";

/**
 * App shell: the site header, the routed page content in a centered reading
 * column, and the shared footer, over a faint floral background that scrolls
 * with the page.
 */
export default function Root() {
  return (
    <div className="relative flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
      <BackgroundPattern />
      <SiteHeader />
      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 px-4">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}
