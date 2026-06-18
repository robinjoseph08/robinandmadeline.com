import Countdown from "@/components/library/Countdown";
import Names from "@/components/library/Names";
import { HERO_IMAGE, WEDDING } from "@/components/pages/home-content";

/** The hero engagement photo as a responsive picture; cropping is up to the caller. */
function HeroPhoto({
  className,
  sizes,
}: {
  className?: string;
  sizes: string;
}) {
  return (
    <picture>
      <source sizes={sizes} srcSet={HERO_IMAGE.avifSrcSet} type="image/avif" />
      <source sizes={sizes} srcSet={HERO_IMAGE.webpSrcSet} type="image/webp" />
      <img
        alt={HERO_IMAGE.alt}
        className={className}
        fetchPriority="high"
        height={HERO_IMAGE.height}
        src={HERO_IMAGE.fallbackSrc}
        width={HERO_IMAGE.width}
      />
    </picture>
  );
}

/**
 * The public landing page: a full-bleed hero photo with the couple's names set
 * on the image, followed by a live countdown to the wedding.
 */
export default function Home() {
  return (
    <div className="pb-4">
      <div className="full-bleed relative">
        <HeroPhoto
          className="h-[70vh] min-h-[460px] w-full object-cover object-[39%_top] sm:h-[86vh] sm:min-h-[560px]"
          sizes="100vw"
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to top, rgba(42,38,34,0.6), rgba(42,38,34,0) 55%)",
          }}
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
          <p
            className="hero-rise text-sm font-semibold uppercase tracking-[0.35em] text-white/90 [text-shadow:0_1px_4px_rgba(42,38,34,1),0_2px_16px_rgba(42,38,34,0.65)]"
            style={{ animationDelay: "120ms" }}
          >
            {WEDDING.tagline}
          </p>
          <h1 className="hero-rise mt-4" style={{ animationDelay: "260ms" }}>
            <Names className="text-[clamp(3.25rem,9vw,6.5rem)] text-white [text-shadow:0_2px_4px_rgba(42,38,34,1),0_4px_30px_rgba(42,38,34,0.65)]" />
          </h1>
          <p
            className="hero-rise mt-5 text-sm font-medium uppercase tracking-[0.2em] text-white/90 [text-shadow:0_1px_4px_rgba(42,38,34,1),0_2px_16px_rgba(42,38,34,0.65)]"
            style={{ animationDelay: "440ms" }}
          >
            <span>{WEDDING.dateText}</span>
            <span className="px-2">&middot;</span>
            <span>{WEDDING.venueText}</span>
          </p>
        </div>
      </div>
      <Countdown />
    </div>
  );
}
