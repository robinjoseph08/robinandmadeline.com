import {
  ArrowLeft,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { useState, type ReactNode } from "react";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCollapsibleSidebar } from "@/hooks/useCollapsibleSidebar";
import { useAuth } from "@/libraries/auth-context";
import { cn } from "@/libraries/utils";

// Active styling keys off NavLink's aria-current="page" (a string className, not
// the {isActive} render-prop) so the link is safe to drop into a Radix
// TooltipTrigger asChild when collapsed, which stringifies a function className.
function navLinkClasses(collapsed: boolean) {
  return cn(
    "flex items-center whitespace-nowrap rounded-md text-sm font-medium transition-colors",
    "text-ink-muted hover:bg-rose-soft hover:text-rose",
    "aria-[current=page]:bg-rose-soft aria-[current=page]:text-rose",
    collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2",
  );
}

// The "Back to Site" link and the collapse toggle share this row styling; the
// padding/centering flips with the collapsed rail. (Sign Out is the Button
// component, styled separately.)
function railRowClasses(collapsed: boolean) {
  return cn(
    "flex items-center whitespace-nowrap rounded-md text-sm font-medium text-ink-muted transition-colors hover:bg-rose-soft hover:text-rose",
    collapsed ? "justify-center px-2 py-2" : "gap-2.5 px-3 py-2",
  );
}

/**
 * Names a sidebar control with a hover tooltip when the rail is collapsed (its
 * visible label is hidden, so the tooltip and the control's aria-label carry the
 * name). When expanded the visible label already names the control, so only the
 * tooltip content drops away, never the wrapper: keeping the element tree stable
 * means toggling the rail updates each control in place instead of remounting it,
 * which would otherwise drop keyboard focus from the collapse toggle as it is
 * activated. The tooltip sits to the right, clear of the rail.
 */
function CollapsibleTooltip({
  collapsed,
  label,
  children,
}: {
  collapsed: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      {collapsed && <TooltipContent side="right">{label}</TooltipContent>}
    </Tooltip>
  );
}

/**
 * The admin navigation: brand, section links, and the exit links (back to the
 * public site, sign out). Shared verbatim by the desktop sidebar and the mobile
 * drawer so the two never drift. The nav flexes to fill the height between the
 * brand and the exit links in both, so the exit group always pins to the bottom.
 * onNavigate, when given, closes the mobile drawer the moment a link is tapped.
 *
 * When collapsed (the desktop rail only), labels give way to icon-only rows
 * named by a hover tooltip (the brand keeps just its aria-label);
 * onToggleCollapse, when given, renders the collapse/expand control at the
 * bottom (the drawer omits it, having no rail to shrink).
 */
function AdminNav({
  collapsed = false,
  onLogout,
  onNavigate,
  onToggleCollapse,
}: {
  collapsed?: boolean;
  onLogout: () => void;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
}) {
  return (
    <>
      <NavLink
        aria-label={collapsed ? "Admin" : undefined}
        className={cn(
          "flex flex-col items-center gap-1 py-2",
          collapsed ? "px-2" : "px-3",
        )}
        end
        onClick={onNavigate}
        to="/admin"
      >
        {/* Decorative: the visible "Admin" label (or the aria-label when
            collapsed) names the link, so the mark is hidden from assistive tech
            to keep the link name from reading "Robin and Madeline floral
            monogram Admin". */}
        <span aria-hidden className="contents">
          <Monogram
            className={collapsed ? "h-8 w-auto" : "h-16 w-auto"}
            sizes={collapsed ? "32px" : "64px"}
          />
        </span>
        {!collapsed && (
          <span className="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-ink-muted">
            Admin
          </span>
        )}
      </NavLink>

      <nav
        aria-label="Admin sections"
        className="-mx-2 mt-6 flex flex-1 flex-col gap-1 overflow-y-auto px-2"
      >
        {ADMIN_NAV_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <CollapsibleTooltip
              collapsed={collapsed}
              key={link.to}
              label={link.label}
            >
              <NavLink
                aria-label={collapsed ? link.label : undefined}
                className={navLinkClasses(collapsed)}
                end={link.end}
                onClick={onNavigate}
                to={link.to}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {!collapsed && link.label}
              </NavLink>
            </CollapsibleTooltip>
          );
        })}
      </nav>

      {/* Exit links grouped at the bottom: back to the public site, or out. */}
      <div className="mt-4 flex flex-col gap-2 border-t border-ink/10 pt-4">
        <CollapsibleTooltip collapsed={collapsed} label="Back to Site">
          <Link
            aria-label={collapsed ? "Back to Site" : undefined}
            className={railRowClasses(collapsed)}
            onClick={onNavigate}
            to="/"
          >
            <ArrowLeft aria-hidden className="size-4 shrink-0" />
            {!collapsed && "Back to Site"}
          </Link>
        </CollapsibleTooltip>
        <CollapsibleTooltip collapsed={collapsed} label="Sign Out">
          <Button
            aria-label={collapsed ? "Sign Out" : undefined}
            className={cn(collapsed && "px-2")}
            onClick={onLogout}
            type="button"
            variant="outline"
          >
            {collapsed ? <LogOut aria-hidden /> : "Sign Out"}
          </Button>
        </CollapsibleTooltip>
      </div>

      {onToggleCollapse && (
        <CollapsibleTooltip collapsed={collapsed} label="Expand sidebar">
          <button
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn("mt-2 cursor-pointer", railRowClasses(collapsed))}
            onClick={onToggleCollapse}
            type="button"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden className="size-4 shrink-0" />
            ) : (
              <>
                <PanelLeftClose aria-hidden className="size-4 shrink-0" />
                Collapse
              </>
            )}
          </button>
        </CollapsibleTooltip>
      )}
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
  const [collapsed, toggleCollapsed] = useCollapsibleSidebar();

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
        <aside
          className={cn(
            "sticky top-0 hidden h-screen shrink-0 flex-col overflow-hidden border-r border-ink/10 bg-page px-3 py-4 transition-[width] duration-200 motion-reduce:transition-none md:flex",
            collapsed ? "w-16" : "w-56",
          )}
        >
          <AdminNav
            collapsed={collapsed}
            onLogout={handleLogout}
            onToggleCollapse={toggleCollapsed}
          />
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
