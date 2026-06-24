import { Heart, Image as ImageIcon } from "lucide-react";
import { type ReactNode } from "react";

import firstDate2Avif640 from "@/assets/story/first-date-2-640.avif";
import firstDate2Avif1080 from "@/assets/story/first-date-2-1080.avif";
import firstDate2Jpg from "@/assets/story/first-date-2-1080.jpg";
import firstDateAvif640 from "@/assets/story/first-date-640.avif";
import firstDateAvif1080 from "@/assets/story/first-date-1080.avif";
import firstDateJpg from "@/assets/story/first-date-1080.jpg";
import howWeMet2Avif640 from "@/assets/story/how-we-met-2-640.avif";
import howWeMet2Avif1080 from "@/assets/story/how-we-met-2-1080.avif";
import howWeMet2Jpg from "@/assets/story/how-we-met-2-1080.jpg";
import howWeMetAvif640 from "@/assets/story/how-we-met-640.avif";
import howWeMetAvif1080 from "@/assets/story/how-we-met-1080.avif";
import howWeMetJpg from "@/assets/story/how-we-met-1080.jpg";
import proposal2Avif640 from "@/assets/story/proposal-2-640.avif";
import proposal2Avif1080 from "@/assets/story/proposal-2-1080.avif";
import proposal2Jpg from "@/assets/story/proposal-2-1080.jpg";
import proposalAvif640 from "@/assets/story/proposal-640.avif";
import proposalAvif1080 from "@/assets/story/proposal-1080.avif";
import proposalJpg from "@/assets/story/proposal-1080.jpg";
import weddingAvif640 from "@/assets/story/wedding-640.avif";
import weddingAvif1080 from "@/assets/story/wedding-1080.avif";
import weddingJpg from "@/assets/story/wedding-1080.jpg";
import PageHeader from "@/components/library/PageHeader";
import { useInView } from "@/hooks/useInView";
import { cn } from "@/libraries/utils";

/**
 * A framed photo for a milestone. The variants are pre-generated from an
 * original with all metadata stripped (privacy) into an AVIF ladder plus a JPEG
 * fallback, mirroring the gallery. To add or replace one, for an `<slug>.jpg`:
 *
 *   magick orig.jpg -auto-orient -strip -resize "640x>"  -quality 55 app/assets/story/<slug>-640.avif
 *   magick orig.jpg -auto-orient -strip -resize "1080x>" -quality 58 app/assets/story/<slug>-1080.avif
 *   magick orig.jpg -auto-orient -strip -resize "1080x>" -quality 80 -interlace JPEG app/assets/story/<slug>-1080.jpg
 *
 * The `>` caps the width without upscaling, so a `-1080` file ends up narrower
 * when the original is smaller (e.g. the 1000px-wide BCD photo). Match each
 * variant's `avifSrcSet` `w` descriptor to its real width, not the filename.
 *
 * then import the variants and add it to a milestone's `photos` below. Within a
 * milestone, `photos` are laid out left to right and overlap; `front` marks the
 * one that sits on top of the others, and `tilt` is its resting angle.
 */
interface MilestonePhoto {
  /** Alt text describing the photo, used as its accessible name. */
  alt: string;
  /** AVIF `srcset` spanning the width ladder; the browser picks by `sizes`. */
  avifSrcSet: string;
  /** JPEG fallback for browsers without AVIF support. */
  fallbackSrc: string;
  /**
   * Responsive `sizes`, e.g. "(min-width: 640px) 18rem, 14rem" (first value is
   * desktop, last is mobile). This is what actually drives each photo's
   * displayed width, not the `max-w`/`max-h` classes: because the `<source>`
   * uses `srcset` width descriptors and the `<img>` is `width: auto`, the
   * browser lays the image out at its `sizes` width (its density-corrected
   * intrinsic size). The `max-w`/`max-h` classes are only safety clamps. So to
   * resize the photos per breakpoint, change these `sizes` values, not the caps.
   * (A browser without AVIF support falls back to the `<img>`'s `src`, which has
   * no `srcset`/`sizes`, so there the image lays out at its intrinsic width
   * clamped by those caps instead, so keep the caps sane for that path too.)
   */
  sizes: string;
  /** Intrinsic dimensions; set the aspect ratio and reserve space pre-load. */
  width: number;
  height: number;
  /** Resting rotation the framed print settles into as it reveals, e.g. "-2deg". */
  tilt: string;
  /** Whether this print stacks on top of the others in its milestone. */
  front?: boolean;
}

// How we met: the crossword conversation (front) over Robin's interests list.
const howWeMetPhoto: MilestonePhoto = {
  alt: "A screenshot of our first Hinge conversation, about the crossword",
  avifSrcSet: `${howWeMetAvif640} 640w, ${howWeMetAvif1080} 1080w`,
  fallbackSrc: howWeMetJpg,
  sizes: "(min-width: 640px) 18rem, 14rem",
  width: 1080,
  height: 1662,
  tilt: "-2.2deg",
  front: true,
};
const howWeMetListPhoto: MilestonePhoto = {
  alt: "The list of interests from Robin's Hinge profile",
  avifSrcSet: `${howWeMet2Avif640} 640w, ${howWeMet2Avif1080} 1080w`,
  fallbackSrc: howWeMet2Jpg,
  sizes: "(min-width: 640px) 18rem, 14rem",
  width: 1080,
  height: 1546,
  tilt: "3.5deg",
};

// First date: the Snapchat (front) over the BCD Tofu House storefront.
const firstDatePhoto: MilestonePhoto = {
  alt: "A Snapchat of the pile of outfits Madeline tried on before our first date",
  avifSrcSet: `${firstDateAvif640} 640w, ${firstDateAvif1080} 1080w`,
  fallbackSrc: firstDateJpg,
  sizes: "(min-width: 640px) 18rem, 14rem",
  width: 1080,
  height: 1920,
  tilt: "1.8deg",
  front: true,
};
const firstDateBcdPhoto: MilestonePhoto = {
  alt: "The exterior of BCD Tofu House, where we had our first date",
  avifSrcSet: `${firstDate2Avif640} 640w, ${firstDate2Avif1080} 1000w`,
  fallbackSrc: firstDate2Jpg,
  sizes: "(min-width: 640px) 20rem, 16rem",
  width: 1000,
  height: 750,
  tilt: "-3deg",
};

// Proposal: the moment itself (front) over the ring photo.
const proposalMomentPhoto: MilestonePhoto = {
  alt: "Robin presenting the ring to Madeline during the proposal",
  avifSrcSet: `${proposal2Avif640} 640w, ${proposal2Avif1080} 1080w`,
  fallbackSrc: proposal2Jpg,
  sizes: "(min-width: 640px) 20rem, 16rem",
  width: 1080,
  height: 773,
  tilt: "-1.4deg",
  front: true,
};
const proposalRingPhoto: MilestonePhoto = {
  alt: "Robin and Madeline showing off the engagement ring just after the proposal",
  avifSrcSet: `${proposalAvif640} 640w, ${proposalAvif1080} 1080w`,
  fallbackSrc: proposalJpg,
  sizes: "(min-width: 640px) 18rem, 14rem",
  width: 1080,
  height: 1620,
  tilt: "3.5deg",
};

// The wedding: a single engagement-shoot photo (for now).
const weddingPhoto: MilestonePhoto = {
  alt: "Robin and Madeline smiling at each other at their engagement shoot",
  avifSrcSet: `${weddingAvif640} 640w, ${weddingAvif1080} 1080w`,
  fallbackSrc: weddingJpg,
  sizes: "(min-width: 672px) 600px, 100vw",
  width: 1080,
  height: 805,
  tilt: "2.4deg",
  front: true,
};

/**
 * Inline "marker" highlights for the story copy. Drop <Blue> or <Pink> around a
 * word or phrase anywhere in a paragraph, e.g. <Blue>2 years</Blue>. The shared
 * chip styling (padding, rounding) lives in Mark so the two always match.
 */
function Mark({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "box-decoration-clone rounded-[0.36em] px-[0.34em] py-[0.08em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

function Blue({ children }: { children: ReactNode }) {
  return <Mark className="bg-secondary text-blue">{children}</Mark>;
}

function Pink({ children }: { children: ReactNode }) {
  return <Mark className="bg-rose-soft text-rose">{children}</Mark>;
}

/**
 * A single milestone on the Our Story timeline: a date, a title, free-form
 * content, and any number of photos. `children` is plain JSX, so a milestone
 * can hold rich text (links, lists, multiple paragraphs).
 *
 * The whole milestone fades up as it scrolls into view, and its photos read as
 * framed prints that settle into a slight tilt. With more than one, they sit as
 * a centered, overlapping cluster. Both effects honor reduced motion via
 * useInView (which reveals everything immediately in that case).
 */
function Milestone({
  date,
  title,
  photos = [],
  overlap = "-ml-[2rem] sm:-ml-[3rem]",
  children,
}: {
  /** Display date, e.g. "June 2019". Placeholder until real dates are set. */
  date: string;
  title: string;
  /** Framed photos, laid out left to right as a centered, overlapping cluster. */
  photos?: MilestonePhoto[];
  /** Negative-margin classes setting how far each photo overlaps the previous. */
  overlap?: string;
  children: ReactNode;
}) {
  const { ref, inView } = useInView<HTMLLIElement>();
  const clustered = photos.length > 1;
  return (
    <li
      className={cn(
        "relative transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none",
        inView ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0",
      )}
      ref={ref}
    >
      {/* Timeline dot, centered on the list's left border. */}
      <span
        aria-hidden
        className="absolute top-1 -left-[31px] size-3 rounded-full bg-rose ring-4 ring-cream sm:-left-[47px]"
      />
      <p className="text-sm font-medium uppercase tracking-widest text-ink/70">
        {date}
      </p>
      <h2 className="mt-1 text-xl font-semibold">{title}</h2>
      <div className="mt-2 leading-relaxed text-ink/80">{children}</div>
      {photos.length > 0 ? (
        <figure className="mt-5 flex items-center justify-center">
          {photos.map((photo, index) => (
            // Framed print: thin white border with a longer polaroid foot and a
            // soft shadow, settling into its tilt as the milestone reveals.
            <span
              className={cn(
                "rounded bg-white p-[0.5rem] pb-[2rem] shadow-[0_12px_30px_rgba(42,38,34,0.14)] transition-transform duration-1000 ease-[cubic-bezier(0.2,0.7,0.2,1)] motion-reduce:transition-none",
                photo.front ? "z-10" : "z-0",
                index > 0 && overlap,
              )}
              key={photo.fallbackSrc}
              style={{
                transform: inView
                  ? `rotate(${photo.tilt})`
                  : "rotate(0deg) translateY(12px)",
              }}
            >
              <picture>
                <source
                  sizes={photo.sizes}
                  srcSet={photo.avifSrcSet}
                  type="image/avif"
                />
                {/* Displayed size is driven by each photo's `sizes`, not these
                    max-* classes (see MilestonePhoto.sizes); they are clamps. */}
                <img
                  alt={photo.alt}
                  className={cn(
                    "block w-auto",
                    clustered
                      ? "max-h-[13rem] max-w-[12.5rem] sm:max-h-[30rem] sm:max-w-[26rem]"
                      : "max-h-[28rem] max-w-full",
                  )}
                  decoding="async"
                  height={photo.height}
                  loading="lazy"
                  src={photo.fallbackSrc}
                  width={photo.width}
                />
              </picture>
            </span>
          ))}
        </figure>
      ) : (
        <div className="mt-5 flex aspect-[4/3] items-center justify-center gap-2 rounded-xl bg-ink/5 text-sm text-ink/70">
          <ImageIcon aria-hidden className="size-5" />
          Photo coming soon
        </div>
      )}
    </li>
  );
}

/**
 * Our Story: a vertical timeline of relationship milestones. Each milestone
 * shows a date, a short blurb, and a photo (or a placeholder until one is
 * added). Copy is hard-coded inline; edit it directly below (each milestone's
 * content is free-form JSX, so rich text is fine).
 */
export default function Story() {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <PageHeader
        subtitle="A few milestones from our journey so far."
        title="Our Story"
      />

      <ol className="mt-12 space-y-12 border-l-2 border-ink/10 pl-6 sm:pl-10">
        <Milestone
          date="October 31, 2023"
          overlap="-ml-[1.25rem] sm:-ml-[2rem]"
          photos={[howWeMetPhoto, howWeMetListPhoto]}
          title="How we met"
        >
          <p>
            We met on Hinge! We&apos;d been on dating apps for{" "}
            <Blue>2 years</Blue> and <Pink>2 weeks</Pink>, and when we saw each
            other&apos;s profiles, we were quite smitten. Robin had actually
            seen Madeline&apos;s profile a few times before finally mustering up
            the courage to actually reply; even though he already knew what he
            was going to comment on, he still had to{" "}
            <Blue>get the wording and emoji placement juuust right</Blue>. After
            matching, Madeline took a screenshot of Robin&apos;s list of
            interests and went around showing her friends and asking{" "}
            <Pink>&quot;Doesn&apos;t this guy seem perfect for me??&quot;</Pink>
            . Even from the early messages, we knew this one was different: it
            was engaging and balanced, and it seemed like we both actually
            wanted to talk to each other. We chatted about solving puzzles,
            maintaining streaks, and reading books, and shortly into the
            conversation, we set up a dinner date in two days!
          </p>
        </Milestone>

        <Milestone
          date="November 2, 2023"
          photos={[firstDateBcdPhoto, firstDatePhoto]}
          title="The first date"
        >
          <p>
            We decided to go to BCD Tofu House, a Korean spot in Carrollton, for
            our first date. <Blue>Robin gave a few options</Blue> to Madeline,
            and since the main character in the book she was reading at the time
            was Korean, <Pink>she ended up picking that one</Pink>. The date was
            absolutely lovely. We got to know each other a bit more, and we
            realized we actually had a lot in common. We&apos;re both middle
            children (and definitely fit the stereotype), we used to be really
            picky eaters (and this quirk peeks through every now and then), and
            we&apos;re both Enneagram 5s (one of the rarest personality types).
            And most importantly, we both knew what we wanted: a long-term
            relationship with the intent of marriage and starting a family. And
            the rest was history.
          </p>
        </Milestone>

        <Milestone
          date="November 2, 2025"
          photos={[proposalMomentPhoto, proposalRingPhoto]}
          title="The proposal"
        >
          <p>
            Robin&apos;s been thinking about{" "}
            <Blue>the best way to propose</Blue> for a long time. He knew pretty
            early on that he wanted it to involve crosswords, but since Madeline
            is so good at solving them, if she saw &quot;will&quot; and
            &quot;you&quot;, she would immediately know what was happening. And
            since the surprise was important to Robin, that wouldn&apos;t do. So
            he came up with the idea that instead of including the words in the
            puzzle, he would just include the <em>letters</em>, spread across
            the grid. And then on completion of the puzzle, the letters would
            light up, rearrange themselves, and spell out &quot;Will you marry
            me?&quot;. It was perfect, except for the fact that there was no
            crossword hosting platform that allowed you to do that. So{" "}
            <Blue>he built it himself</Blue>. He also constructed the actual
            puzzle that she would solve. He told Madeline that he was
            building a general crossword hosting platform, and{" "}
            <Pink>she easily believed him</Pink> since that&apos;s definitely
            something he would do. And on our 2 year anniversary, Robin
            presented the puzzle as an anniversary gift (Madeline{" "}
            <Pink>didn&apos;t notice the camera and the screen recording</Pink>
            ), we went through all of the inside jokes and references in the
            clues, and he popped the question when the words formed on-screen.
          </p>
        </Milestone>

        <Milestone
          date="April 10, 2027"
          photos={[weddingPhoto]}
          title="The wedding"
        >
          <p>
            And now we&apos;re coming up on another one of our important
            milestones, and you&apos;ll be able to join us for this one!
            We&apos;re beyond excited to be able to spend the weekend with all
            of our friends and family. Planning is coming along nicely, and
            we&apos;re slowly seeing our vision for it come together, so we hope
            that you all enjoy it. But we know that this is just the beginning
            of the rest of our lives. We&apos;ve got even more moments that
            we&apos;ll be able to experience together, and we hope you&apos;ll
            continue to be a part of them.{" "}
            <span className="inline-flex items-center gap-1 align-[-0.15em]">
              <Heart aria-hidden className="size-3.5 fill-blue text-blue" />
              <Heart aria-hidden className="size-3.5 fill-rose text-rose" />
            </span>
          </p>
        </Milestone>
      </ol>
    </div>
  );
}
