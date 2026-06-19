import {
  Car,
  Hotel,
  Plane,
  SquareParking,
  type LucideIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";

import PageHeader from "@/components/library/PageHeader";

/**
 * A single titled travel section: an icon chip, an h2 title, and free-form
 * content. `children` is plain JSX, so a section can hold rich text (links,
 * lists, multiple paragraphs) as the copy gets fleshed out.
 */
function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-xl border border-ink/10 bg-primary/30 p-6"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-rose-soft text-rose">
          <Icon aria-hidden className="size-5" />
        </span>
        <h2 className="text-2xl font-semibold" id={headingId}>
          {title}
        </h2>
      </div>
      <div className="mt-4 leading-relaxed text-ink/80">{children}</div>
    </section>
  );
}

/**
 * Travel: logistics for guests traveling in for the wedding, grouped into
 * titled sections. Copy is hard-coded inline; edit it directly below (each
 * section's content is free-form JSX, so rich text is fine).
 */
export default function Travel() {
  return (
    <div className="mx-auto max-w-2xl py-12">
      <PageHeader
        subtitle="How to get here and where to stay while you celebrate with us."
        title="Travel"
      />

      <div className="mt-12 flex flex-col gap-6">
        <Section icon={Plane} title="Flights">
          <p>
            There are two main airports around here: the bigger DFW and the
            smaller DAL (Love Field). Both are fairly close to each other, so
            they don't make too much of a difference in terms of travel
            distance. Some airlines only go to one or the other, so that will
            probably be the determining factor. Either of them are good choices!
          </p>
        </Section>

        <Section icon={Hotel} title="Hotels">
          <p>
            We're putting together a room block and a few nearby places to stay
            at different price points. Booking links and group rates will be
            posted here soon.
          </p>
        </Section>

        <Section icon={Car} title="Rental Cars">
          <p>
            The DFW area is pretty sprawling, and the venue is a bit outside of
            the city, so it's highly encouraged to rent a car if you're flying
            in so that you can easily get around.
          </p>
        </Section>

        <Section icon={SquareParking} title="Parking">
          <p>
            The venue has onsite parking, so if you're driving in or get a
            rental car, parking shouldn't be difficult!
          </p>
        </Section>
      </div>
    </div>
  );
}
