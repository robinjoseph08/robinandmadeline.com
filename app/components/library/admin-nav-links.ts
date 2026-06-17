import type { NavLinkItem } from "@/components/library/nav-links";

/**
 * Admin sidebar navigation links. Each points at a section of the admin area;
 * Dashboard is the overview home with the site's headline stats and settings.
 */
export const ADMIN_NAV_LINKS: NavLinkItem[] = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/guests", label: "Guests" },
  { to: "/admin/parties", label: "Parties" },
  { to: "/admin/events", label: "Events" },
  // "Group Photos" matches the guest-facing schedule section; the URL keeps
  // the original photo-groups slug (renaming routes is churn with no user
  // value).
  { to: "/admin/photo-groups", label: "Group Photos" },
  { to: "/admin/crossword", label: "Crossword" },
  { to: "/admin/emails", label: "Emails" },
];
