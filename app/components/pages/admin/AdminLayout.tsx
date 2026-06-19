import { ArrowLeft, Menu } from "lucide-react";
import { useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { ADMIN_NAV_LINKS } from "@/components/library/admin-nav-links";
import Monogram from "@/components/library/Monogram";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/libraries/auth-context";
import { cn } from "@/libraries/utils";

function linkClasses({ isActive }: { isActive: boolean }) {
  return cn(
    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-rose-soft text-rose"
      : "text-ink-muted hover:bg-rose-soft hover:text-rose",
  );
}

/**
 * The admin navigation: brand, section links, and the exit links (back to the
 * public site, sign out). Shared verbatim by the desktop sidebar and the mobile
 * drawer so the two never drift. The nav flexes to fill the height between the
 * brand and the exit links in both, so the exit group always pins to the bottom.
 * onNavigate, when given, closes the mobile drawer the moment a link is tapped.
 */
function AdminNav({
  onLogout,
  onNavigate,
}: {
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <NavLink
        className="flex flex-col items-center gap-1 px-3 py-2"
        end
        onClick={onNavigate}
        to="/admin"
      >
        {/* Decorative: the visible "Admin" label names the link, so the mark is
            hidden from assistive tech to keep the link name from reading
            "Robin and Madeline floral monogram Admin". */}
        <span aria-hidden className="contents">
          <Monogram className="h-16 w-auto" sizes="64px" />
        </span>
        <span className="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-ink-muted">
          Admin
        </span>
      </NavLink>

      <nav
        aria-label="Admin sections"
        className="-mx-2 mt-6 flex flex-1 flex-col gap-1 overflow-y-auto px-2"
      >
        {ADMIN_NAV_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              className={linkClasses}
              end={link.end}
              key={link.to}
              onClick={onNavigate}
              to={link.to}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {link.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Exit links grouped at the bottom: back to the public site, or out. */}
      <div className="mt-4 flex flex-col gap-2 border-t border-ink/10 pt-4">
        <Link
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-ink-muted transition-colors hover:bg-rose-soft hover:text-rose"
          onClick={onNavigate}
          to="/"
        >
          <ArrowLeft aria-hidden className="size-4 shrink-0" />
          Back to Site
        </Link>
        <Button onClick={onLogout} type="button" variant="outline">
          Sign Out
        </Button>
      </div>
    </>
  );
}

/**
 * Admin shell: the section navigation plus the routed section content. On wide
 * screens the nav is a persistent, sticky sidebar beside the content; on mobile
 * it collapses into a slim top bar whose hamburger opens the same nav as a
 * slide-in drawer, so the content gets the full width instead of permanently
 * sharing it with a sidebar. Rendered only for authenticated admins (behind
 * RequireAdmin).
 */
export default function AdminLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  // Close the drawer on any route change (a nav link or the browser
  // back/forward button), mirroring the public SiteHeader. Reset during render
  // off the previous path rather than in an effect.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setNavOpen(false);
  }

  function handleLogout() {
    setNavOpen(false);
    logout();
    navigate("/admin/login", { replace: true });
  }

  return (
    // disableHoverableContent keeps the hover/in-transit tracking simple so the
    // many icon-button tooltips in the grids trigger reliably (the default
    // hoverable-content path gets confused moving between adjacent triggers).
    <TooltipProvider delayDuration={100} disableHoverableContent>
      <div className="flex min-h-screen bg-background text-foreground">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-ink/10 bg-page px-3 py-4 md:flex">
          <AdminNav onLogout={handleLogout} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile-only top bar: the hamburger opens the nav drawer; the brand
              links home to the dashboard. Hidden once the sidebar appears. */}
          <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink/10 bg-page px-4 py-3 md:hidden">
            <Sheet onOpenChange={setNavOpen} open={navOpen}>
              <SheetTrigger asChild>
                <button
                  aria-label="Open admin navigation"
                  className="-ml-1 rounded-md p-2 text-ink-muted transition-colors hover:bg-rose-soft hover:text-rose"
                  type="button"
                >
                  <Menu className="size-5" />
                </button>
              </SheetTrigger>
              <SheetContent
                aria-describedby={undefined}
                className="flex w-72 flex-col gap-0 px-3 py-4 sm:max-w-none"
                side="left"
              >
                <SheetTitle className="sr-only">Admin navigation</SheetTitle>
                <AdminNav
                  onLogout={handleLogout}
                  onNavigate={() => setNavOpen(false)}
                />
              </SheetContent>
            </Sheet>
            <Link className="flex items-center gap-2" to="/admin">
              <span aria-hidden className="contents">
                <Monogram className="h-8 w-auto" sizes="32px" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-[0.15em] text-ink-muted">
                Admin
              </span>
            </Link>
          </header>

          <main className="min-w-0 flex-1 px-4 py-6 md:px-6 md:py-8">
            <Outlet />
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
