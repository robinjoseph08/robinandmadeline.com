import { Link, Navigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { usePartyRSVPs } from "@/hooks/queries/rsvp";
import { clearGuestToken, readGuestToken } from "@/libraries/guest-api";
import type { RSVPEventGroup, RSVPGuest } from "@/types/generated/rsvps";

/**
 * RSVP confirmation: a summary of the party's submitted responses (who is
 * attending what), a link to the schedule, and a way back to the form for
 * changes (allowed until the deadline). It reads the same query the form
 * uses, which the submit mutation refreshed, so it renders what was just
 * saved.
 */
export default function RSVPConfirmation() {
  const hasToken = readGuestToken() !== null;
  const { data, error, isPending } = usePartyRSVPs({ enabled: hasToken });

  if (!hasToken) {
    return <Navigate replace to="/rsvp" />;
  }
  if (error?.status === 401) {
    clearGuestToken();
    return <Navigate replace to="/rsvp" />;
  }
  if (error) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <p className="text-destructive" role="alert">
          Something went wrong loading your RSVP. Please try again.
        </p>
      </section>
    );
  }
  if (isPending || !data) {
    return (
      <section className="mx-auto max-w-2xl py-8">
        <p className="text-muted-foreground">Loading your RSVP...</p>
      </section>
    );
  }

  const guestNames = new Map(
    data.guests.map((guest: RSVPGuest) => [guest.id, guest.full_name]),
  );

  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">Thank you!</h1>
      <p className="mt-3 text-muted-foreground">
        Here is what we have for {data.party_name}.
        {!data.closed
          ? " You can come back and change your responses any time before the deadline."
          : null}
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {data.events.map((eventGroup: RSVPEventGroup) => {
          const attending = eventGroup.rsvps.filter(
            (entry) => entry.status === "attending",
          );
          const notAttending = eventGroup.rsvps.filter(
            (entry) => entry.status === "not_attending",
          );
          const pending = eventGroup.rsvps.filter(
            (entry) => entry.status === "pending",
          );
          return (
            <section
              aria-label={eventGroup.name}
              className="rounded-lg border border-ink/10 bg-cream p-5"
              key={eventGroup.id}
            >
              <h2 className="text-xl font-semibold">{eventGroup.name}</h2>
              <dl className="mt-3 flex flex-col gap-1 text-sm">
                <div className="flex gap-2">
                  <dt className="font-medium">Attending:</dt>
                  <dd>
                    {attending.length > 0
                      ? attending
                          .map((entry) => guestNames.get(entry.guest_id))
                          .join(", ")
                      : "Nobody yet"}
                  </dd>
                </div>
                {notAttending.length > 0 ? (
                  <div className="flex gap-2">
                    <dt className="font-medium">Not attending:</dt>
                    <dd>
                      {notAttending
                        .map((entry) => guestNames.get(entry.guest_id))
                        .join(", ")}
                    </dd>
                  </div>
                ) : null}
                {pending.length > 0 ? (
                  <div className="flex gap-2">
                    <dt className="font-medium">No response:</dt>
                    <dd>
                      {pending
                        .map((entry) => guestNames.get(entry.guest_id))
                        .join(", ")}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </section>
          );
        })}
      </div>

      <div className="mt-8 flex gap-3">
        <Button asChild>
          <Link to="/schedule">View the schedule</Link>
        </Button>
        {!data.closed ? (
          <Button asChild variant="outline">
            <Link to="/rsvp/form">Edit your RSVP</Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
