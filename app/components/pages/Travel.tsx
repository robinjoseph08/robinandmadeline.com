import {
  BedDouble,
  CalendarDays,
  Car,
  Check,
  ExternalLink,
  Hotel,
  Plane,
  SquareParking,
  type LucideIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";

import { EventLocation } from "@/components/library/EventLocation";
import { Hearts } from "@/components/library/Hearts";
import PageHeader from "@/components/library/PageHeader";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/hooks/usePageTitle";

/**
 * Inline links inherit the surrounding text color and add only an underline and
 * a rose hover, matching the link treatment used elsewhere on the site.
 */
const linkClass =
  "underline underline-offset-2 transition-colors hover:text-rose";

const CONTACT_EMAIL = "wedding@robinandmadeline.com";

/** A hotel we have a room block at, rendered as one card in Hotels. */
interface HotelBlock {
  name: string;
  /** One line on why a guest would pick this hotel. */
  summary: string;
  address: string;
  mapUrl: string;
  /** The hotel's own page, for browsing photos and amenities. */
  websiteUrl: string;
  /** The group booking link, which applies the block's rate. */
  bookingUrl: string;
  /** The block's nightly rate in dollars, before taxes. */
  nightlyRate: number;
  /** Short perks shown as chips. */
  highlights: string[];
}

const HOTELS: HotelBlock[] = [
  {
    name: "GLō Best Western Dallas South DeSoto",
    summary: "A great spot that's central to both of the venues",
    address: "1215 N I-35E, DeSoto, TX 75115",
    mapUrl:
      "https://www.google.com/maps/search/?api=1&query=GL%C5%8D+Best+Western+Dallas+South+DeSoto",
    websiteUrl:
      "https://www.bestwestern.com/en_US/book/hotels-in-desoto/gl%C5%8D-best-western-dallas-south-desoto/propertyCode.44750.html",
    bookingUrl:
      "https://www.bestwestern.com/en_US/book/hotel-rooms.44750.html?groupId=R52AF4Y0",
    nightlyRate: 129,
    highlights: [
      "Free parking",
      "Free breakfast",
      "Free Wi-Fi",
      "2 queens or 1 king",
    ],
  },
  {
    name: "Fairfield by Marriott Inn & Suites Dallas Cedar Hill",
    summary: "Another great option that's a bit cheaper per night",
    address: "409 N Clark Rd, Cedar Hill, TX 75104",
    mapUrl:
      "https://www.google.com/maps/search/?api=1&query=Fairfield+Inn+%26+Suites+Dallas+Cedar+Hill",
    websiteUrl:
      "https://www.marriott.com/en-us/hotels/daleh-fairfield-inn-and-suites-dallas-cedar-hill/overview/",
    bookingUrl:
      "https://app.marriott.com/resview2?id=1791312324782&key=GRP&app=resvlink",
    nightlyRate: 124,
    highlights: [
      "Free parking",
      "Free breakfast",
      "Free Wi-Fi",
      "2 queens or 1 king",
    ],
  },
];

/** The last day to book at either hotel's group rate. */
const BOOKING_CUTOFF = "March 9, 2027";

/**
 * The date ranges both blocks cover: just the wedding vs. a longer stay.
 */
const STAYS = [
  { label: "Just the wedding", dates: "Friday, April 9 to Sunday, April 11" },
  {
    label: "Staying a bit longer",
    dates: "Thursday, April 8 to Monday, April 12",
  },
];

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
      <div className="mt-4 flex flex-col gap-4 leading-relaxed text-ink/80">
        {children}
      </div>
    </section>
  );
}

/**
 * One hotel block: its name and pitch, its nightly rate, a map link on the
 * address, perk chips, and the two ways out (book the group rate, or browse the
 * hotel's own page first). Sits on a raised surface so it reads as a distinct
 * card inside the tinted Hotels section.
 */
function HotelCard({ hotel }: { hotel: HotelBlock }) {
  const headingId = useId();
  return (
    <article
      aria-labelledby={headingId}
      className="rounded-lg border border-line bg-surface p-5 shadow-sm"
    >
      <h3 className="text-xl font-semibold text-ink" id={headingId}>
        {hotel.name}
      </h3>
      <p className="mt-1">{hotel.summary}</p>
      <p className="mt-2 text-sm text-ink-muted">
        <EventLocation location={hotel.address} locationUrl={hotel.mapUrl} />
      </p>

      <ul className="mt-4 flex flex-wrap gap-2">
        {hotel.highlights.map((highlight) => (
          <li
            className="inline-flex items-center gap-1.5 rounded-full bg-rose-soft px-3 py-1 text-sm text-ink"
            key={highlight}
          >
            <Check aria-hidden className="size-3.5 text-rose" />
            {highlight}
          </li>
        ))}
      </ul>

      <div className="mt-5 flex flex-col gap-4 border-t border-line pt-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm">
          <span className="text-2xl font-semibold text-ink">
            ${hotel.nightlyRate}
          </span>{" "}
          per night + taxes
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild>
            <a
              href={hotel.bookingUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              Book the group rate
              <span className="sr-only"> (opens in a new tab)</span>
              <ExternalLink aria-hidden />
            </a>
          </Button>
          <Button asChild variant="outline">
            <a
              href={hotel.websiteUrl}
              rel="noopener noreferrer"
              target="_blank"
            >
              See the hotel
              <span className="sr-only"> (opens in a new tab)</span>
              <ExternalLink aria-hidden />
            </a>
          </Button>
        </div>
      </div>
    </article>
  );
}

/**
 * Travel: logistics for guests traveling in for the wedding, grouped into
 * titled sections. Copy is hard-coded inline; edit it directly below (each
 * section's content is free-form JSX, so rich text is fine). Hotel blocks live
 * in `HOTELS` above.
 */
export default function Travel() {
  usePageTitle("Travel");
  return (
    <div className="mx-auto max-w-2xl py-12">
      <PageHeader
        subtitle="How to get here and where to stay while you celebrate with us."
        title="Travel"
      />

      <div className="mt-12 flex flex-col gap-6">
        <Section icon={Hotel} title="Hotels">
          <p>
            We've reserved blocks of rooms at a group rate! Use the booking
            links below to get it. Make sure to book by{" "}
            <strong>{BOOKING_CUTOFF}</strong>. After that, the group rate for
            both hotels will no longer be available.
          </p>

          <div className="flex gap-3 rounded-lg border border-dashed border-ink/20 p-5">
            <CalendarDays
              aria-hidden
              className="mt-0.5 size-5 shrink-0 text-rose"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                {STAYS.map((stay) => (
                  <div key={stay.label}>
                    <dt className="font-medium text-ink">{stay.label}</dt>
                    <dd>{stay.dates}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm">
                Each booking link is set up for the longer stay, in case you
                want to come a bit early or leave a bit later. If you're just
                coming for the wedding events, adjust your dates before
                continuing.
              </p>
            </div>
          </div>

          {HOTELS.map((hotel) => (
            <HotelCard hotel={hotel} key={hotel.name} />
          ))}

          <div className="flex gap-3">
            <BedDouble aria-hidden className="mt-1 size-5 shrink-0 text-rose" />
            <div className="flex flex-col gap-2">
              <p>
                If you don't see availability for the room type you want for
                either hotel, the block may have run out. Please{" "}
                <strong>
                  text or{" "}
                  <a className={linkClass} href={`mailto:${CONTACT_EMAIL}`}>
                    email us
                  </a>
                </strong>{" "}
                so we can ask the hotel to add more rooms, and you can still get
                the group rate!
              </p>
              <p>
                Also, these were the best prices we could negotiate while trying
                to reserve the blocks, but we've definitely seen these hotels
                available for cheaper if booking outside of the booking link. So
                if you want a better deal, you should do some searching, and
                depending on when you're looking, you might get lucky. These
                hotels are holding rooms for these blocks, but we aren't
                inconvenienced at all if you don't book through them, so do
                what's best for you! <Hearts />
              </p>
            </div>
          </div>
        </Section>

        <Section icon={Plane} title="Flights">
          <p>
            There are two main airports around here: the bigger DFW and the
            smaller DAL (Love Field). Both are fairly close to each other, so
            they don't make too much of a difference in terms of travel
            distance. Some airlines only go to one or the other, so that will
            probably be the determining factor. Either of them are good choices!
          </p>
          <p>
            In terms of timing, if you're just coming for the wedding events, we
            would recommend coming on either the morning of Friday, April 9 or
            the evening of Thursday, April 8. If you come on Friday, be mindful
            of the distances. The Madhuram Veppu starts at 6pm and is ~30
            minutes away from the hotels, which are ~30 minutes from the
            airport, neither of which account for traffic.
          </p>
        </Section>

        <Section icon={Car} title="Rental Cars">
          <p>
            The DFW area is pretty sprawling, and the venues are a bit outside
            of the city, so it's highly encouraged to rent a car if you're
            flying in so that you can easily get around. Parking is free at our
            hotels, so you won't have to pay to keep a car there.
          </p>
          <p>
            In terms of ride sharing apps, you'll definitely be able to get them
            to and from the airport and to and from the Madhuram Veppu venue,
            but it will be harder to get one from the reception venue. It's a
            bit remote, so having your own car or carpooling is recommended.
          </p>
        </Section>

        <Section icon={SquareParking} title="Parking">
          <p>
            The hotels have free parking and the venues for both days have
            onsite parking, so if you're driving in or get a rental car, parking
            shouldn't be difficult!
          </p>
        </Section>
      </div>
    </div>
  );
}
