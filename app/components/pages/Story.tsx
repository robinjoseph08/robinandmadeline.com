import { Heart, Image as ImageIcon } from "lucide-react";
import { type ReactNode } from "react";

import firstDateAvif640 from "@/assets/story/first-date-640.avif";
import firstDateAvif1080 from "@/assets/story/first-date-1080.avif";
import firstDateJpg from "@/assets/story/first-date-1080.jpg";
import howWeMetAvif640 from "@/assets/story/how-we-met-640.avif";
import howWeMetAvif1080 from "@/assets/story/how-we-met-1080.avif";
import howWeMetJpg from "@/assets/story/how-we-met-1080.jpg";
import proposalAvif640 from "@/assets/story/proposal-640.avif";
import proposalAvif1080 from "@/assets/story/proposal-1080.avif";
import proposalJpg from "@/assets/story/proposal-1080.jpg";
import weddingAvif640 from "@/assets/story/wedding-640.avif";
import weddingAvif1080 from "@/assets/story/wedding-1080.avif";
import weddingJpg from "@/assets/story/wedding-1080.jpg";
import PageHeader from "@/components/library/PageHeader";
import { cn } from "@/libraries/utils";

/**
 * A photo for a milestone. The variants are pre-generated from an original with
 * all metadata stripped (privacy) into an AVIF ladder plus a JPEG fallback,
 * mirroring the gallery. To add or replace one, for an original `<slug>.jpg`:
 *
 *   magick orig.jpg -auto-orient -strip -resize 640x  -quality 55 app/assets/story/<slug>-640.avif
 *   magick orig.jpg -auto-orient -strip -resize 1080x -quality 58 app/assets/story/<slug>-1080.avif
 *   magick orig.jpg -auto-orient -strip -resize 1080x -quality 80 -interlace JPEG app/assets/story/<slug>-1080.jpg
 *
 * then import the variants and pass a `photo` to the milestone below.
 */
interface MilestonePhoto {
  /** Alt text describing the photo, used as its accessible name. */
  alt: string;
  /** AVIF `srcset` spanning the width ladder; the browser picks by `sizes`. */
  avifSrcSet: string;
  /** JPEG fallback for browsers without AVIF support. */
  fallbackSrc: string;
  /** `sizes` hint for the displayed width. */
  sizes: string;
  /** Intrinsic dimensions; set the aspect ratio and reserve space pre-load. */
  width: number;
  height: number;
}

const howWeMetPhoto: MilestonePhoto = {
  alt: "A screenshot of our first Hinge conversation, about the crossword",
  avifSrcSet: `${howWeMetAvif640} 640w, ${howWeMetAvif1080} 1080w`,
  fallbackSrc: howWeMetJpg,
  sizes: "18rem",
  width: 1080,
  height: 1662,
};

const firstDatePhoto: MilestonePhoto = {
  alt: "A Snapchat of the pile of outfits Madeline tried on before our first date",
  avifSrcSet: `${firstDateAvif640} 640w, ${firstDateAvif1080} 1080w`,
  fallbackSrc: firstDateJpg,
  sizes: "16rem",
  width: 1080,
  height: 1920,
};

const proposalPhoto: MilestonePhoto = {
  alt: "Robin and Madeline showing off the engagement ring just after the proposal",
  avifSrcSet: `${proposalAvif640} 640w, ${proposalAvif1080} 1080w`,
  fallbackSrc: proposalJpg,
  sizes: "19rem",
  width: 1080,
  height: 1620,
};

const weddingPhoto: MilestonePhoto = {
  alt: "Robin and Madeline smiling at each other at their engagement shoot",
  avifSrcSet: `${weddingAvif640} 640w, ${weddingAvif1080} 1080w`,
  fallbackSrc: weddingJpg,
  sizes: "(min-width: 672px) 600px, 100vw",
  width: 1080,
  height: 805,
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
 * content, and an optional photo. `children` is plain JSX, so a milestone can
 * hold rich text (links, lists, multiple paragraphs) as the copy gets fleshed
 * out. Milestones without a photo yet show a "coming soon" placeholder.
 */
function Milestone({
  date,
  title,
  photo,
  children,
}: {
  /** Display date, e.g. "June 2019". Placeholder until real dates are set. */
  date: string;
  title: string;
  photo?: MilestonePhoto;
  children: ReactNode;
}) {
  return (
    <li className="relative">
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
      {photo ? (
        <picture>
          <source
            sizes={photo.sizes}
            srcSet={photo.avifSrcSet}
            type="image/avif"
          />
          <img
            alt={photo.alt}
            className="mx-auto mt-5 block max-h-[28rem] w-auto max-w-full rounded-xl"
            decoding="async"
            height={photo.height}
            loading="lazy"
            src={photo.fallbackSrc}
            width={photo.width}
          />
        </picture>
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
          photo={howWeMetPhoto}
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
          photo={firstDatePhoto}
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
          photo={proposalPhoto}
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
            <Blue>he built it himself</Blue>. In addition to actually
            constructing the puzzle that she would solve. He told Madeline that
            he was building a general crossword hosting platform, and{" "}
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
          photo={weddingPhoto}
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
