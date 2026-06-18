import {
  CalendarDays,
  Camera,
  LayoutDashboard,
  Mail,
  Puzzle,
  Settings,
  UserRound,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import type { NavLinkItem } from "@/components/library/nav-links";

export interface AdminNavLink extends NavLinkItem {
  icon: LucideIcon;
}

/**
 * Admin sidebar navigation links. Each points at a section of the admin area;
 * Dashboard is the overview home with the site's headline stats, and Settings
 * holds the site-wide app settings.
 */
export const ADMIN_NAV_LINKS: AdminNavLink[] = [
  { to: "/admin", label: "Dashboard", end: true, icon: LayoutDashboard },
  { to: "/admin/guests", label: "Guests", icon: UserRound },
  { to: "/admin/parties", label: "Parties", icon: UsersRound },
  { to: "/admin/events", label: "Events", icon: CalendarDays },
  // "Group Photos" matches the guest-facing schedule section; the URL keeps the
  // original photo-groups slug (renaming routes is churn with no user value).
  { to: "/admin/photo-groups", label: "Group Photos", icon: Camera },
  { to: "/admin/crossword", label: "Crossword", icon: Puzzle },
  { to: "/admin/emails", label: "Emails", icon: Mail },
  { to: "/admin/settings", label: "Settings", icon: Settings },
];
