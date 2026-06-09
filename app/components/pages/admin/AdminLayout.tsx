import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { ADMIN_NAV_LINKS } from "@/components/library/admin-nav-links";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/libraries/auth-context";
import { cn } from "@/libraries/utils";

function linkClasses({ isActive }: { isActive: boolean }) {
  return cn(
    "rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-primary",
    isActive && "bg-primary",
  );
}

/**
 * Admin shell: a persistent sidebar with navigation to every admin section plus
 * the routed section content. Rendered only for authenticated admins (behind
 * RequireAdmin).
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
        <aside className="flex w-56 shrink-0 flex-col border-r border-ink/10 bg-cream px-3 py-4">
          <NavLink className="px-3 text-lg font-bold" end to="/admin">
            R &amp; M Admin
          </NavLink>

          <nav aria-label="Admin sections" className="mt-6 flex flex-col gap-1">
            {ADMIN_NAV_LINKS.map((link) => (
              <NavLink
                className={linkClasses}
                end={link.end}
                key={link.to}
                to={link.to}
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          {/* Exit links grouped at the bottom: back to the public site, or out. */}
          <div className="mt-auto flex flex-col gap-2">
            <Link
              className="rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-primary"
              to="/"
            >
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
