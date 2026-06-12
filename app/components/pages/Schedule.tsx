import { CalendarPlus, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useScheduleEvents } from "@/hooks/queries/schedule";
import { downloadICS, googleCalendarUrl } from "@/libraries/calendar";
import { formatEventWhen } from "@/libraries/format";
import type { ScheduleEvent } from "@/types/generated/events";

/**
 * The schedule page, one page for both audiences: anonymous visitors see the
 * public events, and a visitor with a stored guest token also sees the
 * private events their party is invited to (marked with a badge). Each event
 * offers an .ics download and a prefilled Google Calendar link, both built on
 * the client from the event's fields. Visitors without a token get a subtle
 * pointer to code entry, where logging in unlocks their full schedule.
 */
export default function Schedule() {
  const { data, error, isPending } = useScheduleEvents();

  if (error) {
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
      <p className="mt-3 text-muted-foreground">
        Here is everything we have planned for the weekend.
      </p>
      {!data.authenticated ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Have an invitation?{" "}
          <Link className="underline underline-offset-2" to="/rsvp">
            Enter your party code
          </Link>{" "}
          to see your full schedule.
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
          <a href={googleCalendarUrl(event)} rel="noreferrer" target="_blank">
            <ExternalLink aria-hidden="true" />
            Google Calendar
          </a>
        </Button>
      </div>
    </article>
  );
}
