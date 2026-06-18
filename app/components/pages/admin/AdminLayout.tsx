import { ArrowLeft } from "lucide-react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { ADMIN_NAV_LINKS } from "@/components/library/admin-nav-links";
import Monogram from "@/components/library/Monogram";
import { Button } from "@/components/ui/button";
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
 * Admin shell: a persistent, sticky sidebar with navigation to every admin
 * section plus the routed section content. Rendered only for authenticated
 * admins (behind RequireAdmin).
 */
export default function AdminLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/admin/login", { replace: true });
  }

  return (
    // disableHoverableContent keeps the hover/in-transit tracking simple so the
    // many icon-button tooltips in the grids trigger reliably (the default
    // hoverable-content path gets confused moving between adjacent triggers).
    <TooltipProvider delayDuration={100} disableHoverableContent>
      <div className="flex min-h-screen bg-background text-foreground">
        <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-ink/10 bg-page px-3 py-4">
          <NavLink
            className="flex flex-col items-center gap-1 px-3 py-2"
            end
            to="/admin"
          >
            <Monogram className="h-16 w-auto" sizes="64px" />
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
              to="/"
            >
              <ArrowLeft aria-hidden className="size-4 shrink-0" />
              Back to site
            </Link>
            <Button onClick={handleLogout} type="button" variant="outline">
              Sign out
            </Button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
    </TooltipProvider>
  );
}
