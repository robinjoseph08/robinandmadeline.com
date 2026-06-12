import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import { HOME_CTA_CARDS, WEDDING } from "@/components/pages/home-content";
import { cn } from "@/libraries/utils";

/**
 * The public landing page: an invitation-style hero (names, date, venue)
 * followed by call-to-action cards into the rest of the site.
 */
export default function Home() {
  return (
    <div className="py-14 sm:py-20">
      <section className="text-center">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-ink/60">
          {WEDDING.tagline}
        </p>
        <h1 className="mt-5 text-5xl font-bold tracking-tight sm:text-7xl">
          {WEDDING.partnerOne}{" "}
          <span className="text-complementary-2">&amp;</span>{" "}
          {WEDDING.partnerTwo}
        </h1>

        {/* Decorative palette divider between the names and the details. */}
        <div
          aria-hidden
          className="mt-8 flex items-center justify-center gap-2"
        >
          <span className="size-1.5 rounded-full bg-complementary-2" />
          <span className="size-1.5 rounded-full bg-secondary" />
          <span className="size-1.5 rounded-full bg-complementary-1" />
        </div>

        <p className="mt-8 text-lg text-ink/80">{WEDDING.dateText}</p>
        <p className="mt-1 text-ink/60">{WEDDING.venueText}</p>
      </section>

      <section
        aria-label="Explore the site"
        className="mt-16 grid gap-4 sm:grid-cols-3"
      >
        {HOME_CTA_CARDS.map((card) => (
          <Link
            className={cn(
              "group rounded-xl p-6 shadow-sm transition-transform hover:-translate-y-0.5",
              card.colorClass,
            )}
            key={card.to}
            to={card.to}
          >
            <h2 className="text-lg font-semibold">{card.title}</h2>
            <p className="mt-1 text-sm text-ink/70">{card.description}</p>
            <ArrowRight
              aria-hidden
              className="mt-4 size-4 transition-transform group-hover:translate-x-1"
            />
          </Link>
        ))}
      </section>
    </div>
  );
}
