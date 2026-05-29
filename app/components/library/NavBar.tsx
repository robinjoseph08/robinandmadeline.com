import { Menu, X } from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";

import { NAV_LINKS } from "@/components/library/nav-links";
import { cn } from "@/libraries/utils";

function linkClasses({ isActive }: { isActive: boolean }) {
  return cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-primary",
    isActive && "bg-primary",
  );
}

/**
 * Responsive top navigation bar: a full horizontal row of links on desktop,
 * collapsing to a hamburger-triggered menu on mobile.
 */
export default function NavBar() {
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-ink/10 bg-cream">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <NavLink className="text-lg font-bold" to="/">
          R &amp; M
        </NavLink>

        {/* Desktop links */}
        <div className="hidden items-center gap-1 md:flex">
          {NAV_LINKS.map((link) => (
            <NavLink
              className={linkClasses}
              end={link.end}
              key={link.to}
              to={link.to}
            >
              {link.label}
            </NavLink>
          ))}
        </div>

        {/* Mobile hamburger toggle */}
        <button
          aria-expanded={open}
          aria-label="Toggle navigation menu"
          className="rounded-md p-2 hover:bg-primary md:hidden"
          onClick={() => setOpen((v) => !v)}
          type="button"
        >
          {open ? <X /> : <Menu />}
        </button>
      </nav>

      {/* Mobile menu */}
      {open ? (
        <div
          className="flex flex-col gap-1 px-4 pb-4 md:hidden"
          data-testid="mobile-menu"
        >
          {NAV_LINKS.map((link) => (
            <NavLink
              className={linkClasses}
              end={link.end}
              key={link.to}
              onClick={() => setOpen(false)}
              to={link.to}
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      ) : null}
    </header>
  );
}
