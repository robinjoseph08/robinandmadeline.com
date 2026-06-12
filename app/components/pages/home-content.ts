/**
 * Hardcoded copy for the home page hero. The date and venue are placeholders
 * until the couple finalizes details; swap the strings here when they do.
 */
export const WEDDING = {
  partnerOne: "Robin",
  partnerTwo: "Madeline",
  tagline: "We're getting married",
  dateText: "Date to be announced",
  venueText: "Venue & city to be announced",
};

export interface CtaCard {
  to: string;
  title: string;
  description: string;
  /** Tailwind background utility from the wedding palette. */
  colorClass: string;
}

/** The call-to-action cards shown under the home page hero. */
export const HOME_CTA_CARDS: CtaCard[] = [
  {
    to: "/rsvp",
    title: "RSVP",
    description: "Let us know if you can make it.",
    colorClass: "bg-primary",
  },
  {
    to: "/schedule",
    title: "Schedule",
    description: "See the weekend's events and timing.",
    colorClass: "bg-secondary",
  },
  {
    to: "/story",
    title: "Our Story",
    description: "How we got from hello to here.",
    colorClass: "bg-complementary-1",
  },
];
