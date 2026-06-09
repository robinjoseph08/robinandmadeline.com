import type { NavLinkItem } from "@/components/library/nav-links";

/**
 * Admin sidebar navigation links. Each points at a section of the admin area;
 * the sections themselves are placeholders until later issues flesh them out.
 */
export const ADMIN_NAV_LINKS: NavLinkItem[] = [
  { to: "/admin", label: "Dashboard", end: true },
  { to: "/admin/guests", label: "Guests" },
  { to: "/admin/parties", label: "Parties" },
  { to: "/admin/events", label: "Events" },
  { to: "/admin/photo-groups", label: "Photo Groups" },
  { to: "/admin/emails", label: "Emails" },
];
