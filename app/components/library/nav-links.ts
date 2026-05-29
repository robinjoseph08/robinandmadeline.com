export interface NavLinkItem {
  to: string;
  label: string;
  /** When true, only marks active on an exact path match (used for "/"). */
  end?: boolean;
}

/** Primary public navigation links shown in the top nav bar. */
export const NAV_LINKS: NavLinkItem[] = [
  { to: "/", label: "Home", end: true },
  { to: "/story", label: "Our Story" },
  { to: "/schedule", label: "Schedule" },
  { to: "/games", label: "Games" },
  { to: "/photos", label: "Photos" },
  { to: "/faq", label: "FAQ" },
  { to: "/rsvp", label: "RSVP" },
];
