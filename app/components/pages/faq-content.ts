export interface FAQItem {
  question: string;
  answer: string;
}

/**
 * Frequently asked questions, in display order. The answers are placeholders
 * until the couple finalizes the details; update the copy here when they do.
 */
export const FAQ_ITEMS: FAQItem[] = [
  {
    question: "What should I wear?",
    answer:
      "Dress code details are coming soon. We'll share specifics here once they're finalized.",
  },
  {
    question: "How should I plan to get around?",
    answer:
      "Travel and transportation tips, including whether you'll want a rental car, will be posted here closer to the big day.",
  },
  {
    question: "Do you have a registry?",
    answer:
      "Gift and registry details will live here once they're ready. Celebrating with you is what we're most excited about.",
  },
  {
    question: "Where is the venue, and what should I know about it?",
    answer:
      "Venue details, directions, and parking information will be added here once everything is locked in.",
  },
];
