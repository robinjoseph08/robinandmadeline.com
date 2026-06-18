import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import Names from "@/components/library/Names";
import { NAV_LINKS, type NavLinkItem } from "@/components/library/nav-links";
import { useAuth } from "@/libraries/auth-context";
import { cn } from "@/libraries/utils";

type Tone = "ink" | "onImage";

/** Link styling per tone, with a soft pill on hover and the active route. */
function navItemClass(tone: Tone) {
  return ({ isActive }: { isActive: boolean }) =>
    cn(
      "rounded-full px-3 py-1.5 text-sm font-medium tracking-[0.01em] transition-colors",
      tone === "ink"
        ? "text-ink-muted hover:bg-rose-soft hover:text-rose"
        : "text-white hover:bg-white/15 [text-shadow:0_1px_4px_rgba(42,38,34,1),0_1px_10px_rgba(42,38,34,0.6)]",
      isActive &&
        (tone === "ink" ? "bg-rose-soft text-rose" : "bg-white/20 text-white"),
    );
}

function NavItems({
  items,
  tone,
  onNavigate,
}: {
  items: NavLinkItem[];
  tone: Tone;
  onNavigate?: () => void;
}) {
  return (
    <>
      {items.map((link) => (
        <NavLink
          className={navItemClass(tone)}
          end={link.end}
          key={link.to}
          onClick={onNavigate}
          to={link.to}
        >
          {link.label}
        </NavLink>
      ))}
    </>
  );
}

/**
 * The site header. On the home page the nav floats transparently over the hero
 * photo (the names live on the photo itself); on every other page it is a solid
 * two-tier bar with the names above the nav row, collapsing to a name + burger
 * on mobile.
 */
export default function SiteHeader() {
  const { isAuthenticated } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Close the mobile menu on any route change (a nav link, the logo, or the
  // browser back/forward button) so it never lingers open over the next page.
  // Reset during render off the previous path rather than in an effect.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }

  const overlay = pathname === "/";
  const items: NavLinkItem[] = isAuthenticated
    ? [...NAV_LINKS, { to: "/admin", label: "Admin" }]
    : NAV_LINKS;

  const mobileToggle = (
    <button
      aria-expanded={open}
      aria-label="Toggle navigation menu"
      className={cn(
        "rounded-md p-2 transition-colors md:hidden",
        overlay
          ? "text-white hover:bg-white/15"
          : "text-ink hover:bg-rose-soft",
      )}
      onClick={() => setOpen((value) => !value)}
      type="button"
    >
      {open ? <X /> : <Menu />}
    </button>
  );

  const mobileMenu = open ? (
    <div
      className="border-b border-line bg-page md:hidden"
      data-testid="mobile-menu"
    >
      <nav className="mx-auto flex max-w-5xl flex-col gap-1 px-4 pb-4 pt-1">
        <NavItems items={items} onNavigate={() => setOpen(false)} tone="ink" />
      </nav>
    </div>
  ) : null;

  if (overlay) {
    return (
      <header className="absolute inset-x-0 top-0 z-30">
        {/* Soft top scrim so the white nav stays legible over a bright photo. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/45 to-transparent"
        />
        <div className="relative mx-auto flex max-w-5xl items-center justify-between px-4 py-5">
          <Link
            aria-label="Robin and Madeline, home"
            className="font-display text-lg font-normal tracking-wide text-white [text-shadow:0_1px_4px_rgba(42,38,34,1),0_1px_10px_rgba(42,38,34,0.6)]"
            to="/"
          >
            R<span className="px-0.5 text-[0.85em]">&amp;</span>M
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            <NavItems items={items} tone="onImage" />
          </nav>
          {mobileToggle}
        </div>
        {mobileMenu}
      </header>
    );
  }

  return (
    <header className="relative z-30 border-b border-line bg-page">
      <div className="mx-auto max-w-5xl px-4">
        <div className="flex items-center justify-between py-4 md:flex-col md:items-center md:gap-4 md:py-7">
          <Link
            aria-label="Robin and Madeline, home"
            className="transition-opacity hover:opacity-80"
            to="/"
          >
            <Names className="text-[clamp(1.875rem,4.5vw,3rem)] text-rose" />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            <NavItems items={items} tone="ink" />
          </nav>
          {mobileToggle}
        </div>
      </div>
      {mobileMenu}
    </header>
  );
}
