import { Menu, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";

import Monogram from "@/components/library/Monogram";
import Names from "@/components/library/Names";
import { NAV_LINKS, type NavLinkItem } from "@/components/library/nav-links";
import { useAuth } from "@/libraries/auth-context";
import { cn } from "@/libraries/utils";

type Tone = "ink" | "onImage";

/**
 * Link styling per tone. The horizontal top nav wears a soft pill on hover and
 * the active route; the stacked mobile menu wears larger, full-width rows whose
 * active route fills with a soft rose rounded rectangle (a clean fill, no ring,
 * so it reads as a selected row rather than an outlined button).
 */
function navItemClass(tone: Tone, stacked: boolean) {
  return ({ isActive }: { isActive: boolean }) =>
    cn(
      "font-medium tracking-[0.01em] transition-colors",
      stacked
        ? "rounded-lg px-3 py-2.5 text-base"
        : "rounded-full px-3 py-1.5 text-sm",
      tone === "ink"
        ? "text-ink-muted hover:bg-rose-soft hover:text-rose"
        : "text-white hover:bg-white/15 [text-shadow:0_1px_4px_rgba(42,38,34,1),0_1px_10px_rgba(42,38,34,0.6)]",
      isActive && tone === "ink" && "bg-rose-soft text-rose",
      isActive && tone === "onImage" && "bg-white/20 text-white",
    );
}

function NavItems({
  items,
  tone,
  stacked = false,
  onNavigate,
}: {
  items: NavLinkItem[];
  tone: Tone;
  stacked?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      {items.map((link) => (
        <NavLink
          className={navItemClass(tone, stacked)}
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
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the mobile menu on any route change (a nav link, the logo, or the
  // browser back/forward button) so it never lingers open over the next page.
  // Reset during render off the previous path rather than in an effect.
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setOpen(false);
  }

  // The open menu is a full-screen modal, so while it is open lock body scroll
  // (the page behind must not drift), move focus into the panel, and restore
  // focus to whatever opened it on close. Escape-to-close and tab-trapping are
  // handled by the panel's own key handler below; role="dialog" + aria-modal
  // expose it as a modal dialog to assistive tech.
  useEffect(() => {
    if (!open) {
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current
      ?.querySelector<HTMLElement>("a[href], button:not([disabled])")
      ?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open]);

  // Keep keyboard focus inside the open panel (wrap at both ends) and close it
  // on Escape. Events bubble up from the focused control within the panel.
  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusables = menuRef.current?.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled])",
    );
    if (!focusables || focusables.length === 0) {
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
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
        // -mr-2 cancels the button's right padding so the icon's edge lines up
        // with the brand on the left at the row's px-4 inset, not 8px inside it.
        "-mr-2 rounded-md p-2 transition-colors md:hidden",
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

  // The open mobile menu is a full-screen panel rather than a dropdown: on the
  // home page a short dropdown left the hero photo peeking below it, which read
  // as half-finished. As a fixed overlay it covers the page for a clean,
  // focused menu on every route (its own top bar mirrors the header bar).
  const mobileMenu = open ? (
    <div
      aria-label="Site navigation"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-page md:hidden"
      data-testid="mobile-menu"
      onKeyDown={handleMenuKeyDown}
      ref={menuRef}
      role="dialog"
    >
      <div className="flex shrink-0 items-center justify-between px-4 py-5">
        <span className="font-display text-lg font-normal tracking-wide text-rose">
          R<span className="px-0.5 text-[0.85em]">&amp;</span>M
        </span>
        <button
          aria-label="Close navigation menu"
          className="-mr-2 rounded-md p-2 text-ink transition-colors hover:bg-rose-soft"
          onClick={() => setOpen(false)}
          type="button"
        >
          <X />
        </button>
      </div>
      {/* Items top-aligned; the nav fills the height above the foot mark and
          scrolls on its own when the list outgrows the screen, so the top bar
          and the monogram stay put while the links scroll between them. */}
      <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4">
        <NavItems
          items={items}
          onNavigate={() => setOpen(false)}
          stacked
          tone="ink"
        />
      </nav>
      {/* The floral mark anchors the foot of the menu, echoing the site footer
          so the full-screen panel reads as finished rather than half-empty. It
          is purely decorative here (the brand is already at the top), so it is
          hidden from assistive tech. */}
      <div aria-hidden className="shrink-0 px-4 pb-10 pt-6 text-center">
        <Monogram className="mx-auto h-14 w-auto" sizes="56px" />
      </div>
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
        <div className="flex items-center justify-between py-5 md:flex-col md:items-center md:gap-4 md:py-7">
          <Link
            aria-label="Robin and Madeline, home"
            className="transition-opacity hover:opacity-80"
            to="/"
          >
            {/* Mobile: the compact mark, matching the home bar and the menu so
                the brand reads consistently and sits cleanly beside the burger
                (the full script names crowd that slim row and align awkwardly).
                Desktop: the script names take over as the centered centerpiece,
                where there is room and no hero to carry them. */}
            <span className="font-display text-lg font-normal tracking-wide text-rose md:hidden">
              R<span className="px-0.5 text-[0.85em]">&amp;</span>M
            </span>
            <Names className="hidden text-[clamp(1.875rem,4.5vw,3rem)] text-rose md:inline-block" />
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
