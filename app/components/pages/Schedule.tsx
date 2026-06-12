import { CalendarPlus, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePartyPhotoGroups } from "@/hooks/queries/photo-groups";
import { useScheduleEvents } from "@/hooks/queries/schedule";
import { downloadICS, googleCalendarUrl } from "@/libraries/calendar";
import { formatEventWhen, formatPhotoGroupLine } from "@/libraries/format";
import type { ScheduleEvent } from "@/types/generated/events";

/**
 * The schedule page, one page for both audiences: anonymous visitors see the
 * public events, and a visitor with a stored guest token also sees the
 * private events their party is invited to (marked with a badge) plus a
 * photos section naming which of their party's guests are in which photo
 * groups. Each event offers an .ics download and a prefilled Google Calendar
 * link, both built on the client from the event's fields. Visitors without a
 * token get a subtle pointer to code entry, where logging in unlocks their
 * full schedule.
 */
export default function Schedule() {
  const { data, error, isPending } = useScheduleEvents();

  // Only a failure with nothing to show becomes the error page: when a
  // background refetch fails, the cached schedule the visitor is already
  // reading stays up instead of being swapped for a banner.
  if (error && !data) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <p className="text-destructive" role="alert">
          Something went wrong loading the schedule. Please try again.
        </p>
      </section>
    );
  }
  if (isPending || !data) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <p className="text-muted-foreground">Loading the schedule...</p>
      </section>
    );
  }

  const events = data.schedule.items;

  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">Schedule</h1>
      {/* The anonymous view may be missing the party's private events, so
          only the authenticated intro claims to be everything. */}
      <p className="mt-3 text-muted-foreground">
        {data.authenticated
          ? "Here is everything we have planned for the weekend."
          : "Here is what is happening over the wedding weekend."}
      </p>
      {!data.authenticated ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Have an invitation?{" "}
          <Link className="underline underline-offset-2" to="/rsvp">
            Enter your party code
          </Link>{" "}
          to unlock your full schedule.
        </p>
      ) : null}

      {events.length === 0 ? (
        <p className="mt-6 text-muted-foreground">
          The schedule is still coming together. Check back soon!
        </p>
      ) : (
        <div className="mt-6 flex flex-col gap-6">
          {events.map((event) => (
            <EventCard
              authenticated={data.authenticated}
              event={event}
              key={event.id}
            />
          ))}
        </div>
      )}

      {/* Photo groups are not tied to an event (the one photo session sits
          between the ceremony and the reception), so they get their own
          section rather than a line on an event card. Mounted only for
          authenticated visitors: the data is per-party. */}
      {data.authenticated ? <PhotosSection /> : null}
    </section>
  );
}

/**
 * The photos section: the photo groups the visitor's party is in, naming
 * which of the party's guests each group needs and where it falls in the
 * shooting order. Renders nothing until the data is in and only when the
 * party has at least one assignment, so parties outside the shot list never
 * see an empty shell (and a failed fetch quietly hides the section rather
 * than disturbing the schedule above it).
 */
function PhotosSection() {
  const { data } = usePartyPhotoGroups();

  const groups = data?.items ?? [];
  if (groups.length === 0) return null;

  return (
    <section aria-label="Photos" className="mt-10">
      <h2 className="text-2xl font-semibold">Photos</h2>
      <p className="mt-3">
        We'll be taking group photos after the ceremony, before the reception.
        Here is where we need you:
      </p>
      <ul className="mt-3 list-disc space-y-1 pl-5">
        {groups.map((group) => (
          <li key={group.id}>{formatPhotoGroupLine(group)}</li>
        ))}
      </ul>
    </section>
  );
}

interface EventCardProps {
  event: ScheduleEvent;
  authenticated: boolean;
}

function EventCard({ event, authenticated }: EventCardProps) {
  return (
    <article
      aria-label={event.name}
      className="rounded-lg border border-ink/10 bg-cream p-5"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold">{event.name}</h2>
        {/* Private events only reach the response for an invited party, so in
            the authenticated view the badge reads as "this one is special,
            just for you". */}
        {authenticated && !event.is_public ? (
          <Badge variant="secondary">You're invited</Badge>
        ) : null}
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {formatEventWhen(event)}
      </p>
      {event.location ? (
        <p className="mt-1 text-sm text-muted-foreground">{event.location}</p>
      ) : null}
      {event.description ? <p className="mt-3">{event.description}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => downloadICS(event)}
          size="sm"
          type="button"
          variant="outline"
        >
          <CalendarPlus aria-hidden="true" />
          Add to Calendar (.ics)
        </Button>
        <Button asChild size="sm" variant="outline">
          <a
            aria-label="Google Calendar (opens in new tab)"
            href={googleCalendarUrl(event)}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" />
            Google Calendar
          </a>
        </Button>
      </div>
    </article>
  );
}
