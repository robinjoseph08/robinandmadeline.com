import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";

import {
  HERO_IMAGE,
  HOME_CTA_CARDS,
  WEDDING,
} from "@/components/pages/home-content";
import { cn } from "@/libraries/utils";

/**
 * How wide the hero photo renders, for the browser's srcset selection:
 * the full viewport minus Root's px-4 gutters, capped by its max-w-5xl
 * (64rem) container. Keep in sync with the Root layout if it changes.
 */
const HERO_IMAGE_SIZES = "(min-width: 64rem) 62rem, calc(100vw - 2rem)";

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

        <picture>
          <source
            sizes={HERO_IMAGE_SIZES}
            srcSet={HERO_IMAGE.avifSrcSet}
            type="image/avif"
          />
          <source
            sizes={HERO_IMAGE_SIZES}
            srcSet={HERO_IMAGE.webpSrcSet}
            type="image/webp"
          />
          <img
            alt={HERO_IMAGE.alt}
            className="mt-10 w-full rounded-2xl shadow-sm"
            fetchPriority="high"
            height={HERO_IMAGE.height}
            src={HERO_IMAGE.fallbackSrc}
            width={HERO_IMAGE.width}
          />
        </picture>
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
