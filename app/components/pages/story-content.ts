export interface Milestone {
  /** Display date, e.g. "June 2019". Placeholder until real dates are set. */
  date: string;
  title: string;
  /** A short 2-3 sentence story for the milestone. */
  blurb: string;
  /** Tailwind background utility for the photo placeholder block. */
  photoColorClass: string;
}

/**
 * Relationship milestones shown on the Our Story timeline, oldest first.
 * All entries are placeholders; replace the copy (and eventually the photo
 * placeholders) with the couple's real content.
 */
export const MILESTONES: Milestone[] = [
  {
    date: "Month 20XX",
    title: "How we met",
    blurb:
      "This is where the story of how we first crossed paths will go. We promise it's a good one. Check back soon for the full details.",
    photoColorClass: "bg-primary",
  },
  {
    date: "Month 20XX",
    title: "Our first date",
    blurb:
      "A placeholder for the story of our first date. The real version, nerves and all, is coming soon.",
    photoColorClass: "bg-secondary",
  },
  {
    date: "Month 20XX",
    title: "The proposal",
    blurb:
      "The proposal story will live here once we've written it down. Spoiler: the answer was yes.",
    photoColorClass: "bg-complementary-1",
  },
  {
    date: "Soon",
    title: "The wedding",
    blurb:
      "The next big milestone is the one we're planning right now. We can't wait to celebrate it with you.",
    photoColorClass: "bg-primary",
  },
];
