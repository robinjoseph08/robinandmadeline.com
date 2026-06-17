import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { resetGuestQueries } from "@/hooks/queries/guest-cache";
import { usePartyRSVPs } from "@/hooks/queries/rsvp";
import { formatLongDate } from "@/libraries/format";
import { clearGuestToken, readGuestToken } from "@/libraries/guest-api";
import { isNamedPlaceholder } from "@/libraries/placeholders";
import type { EventRSVPStatus } from "@/types/generated/models";
import type {
  PartyRSVPsResponse,
  RSVPEventGroup,
  RSVPGuest,
} from "@/types/generated/rsvps";

/** Human label for a stored status. */
function statusLabel(status: EventRSVPStatus): string {
  switch (status) {
    case "attending":
      return "Attending";
    case "not_attending":
      return "Not attending";
    default:
      return "No response";
  }
}

/**
 * A guest's invited events with their status for each: the groups holding an
 * Event RSVP row for them (the row is the invitation).
 */
function guestEntries(
  data: PartyRSVPsResponse,
  guest: RSVPGuest,
): { event: RSVPEventGroup; status: EventRSVPStatus }[] {
  return data.events.flatMap((event) => {
    const entry = event.rsvps.find((rsvp) => rsvp.guest_id === guest.id);
    return entry ? [{ event, status: entry.status }] : [];
  });
}

/**
 * RSVP confirmation: one card per guest (mirroring the form) summarizing
 * their submitted response to each event plus their dietary restrictions, a
 * link to the schedule, and a way back to the form for changes (allowed until
 * the deadline; after it, a "contact us" message replaces the edit button).
 * It reads the same query the form uses, which the submit mutation refreshed,
 * so it renders what was just saved. "Not your party?" clears the stored
 * guest token and returns to code entry, for a visitor whose stored token
 * landed them on someone else's party.
 */
export default function RSVPConfirmation() {
  const hasToken = readGuestToken() !== null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data, error, isPending } = usePartyRSVPs({ enabled: hasToken });

  // The escape hatch for a visitor looking at someone else's party (a shared
  // device, or a mistyped code remembered by the stored token): forget the
  // token and land back on code entry. Every guest-scoped cache goes with the
  // token: it belongs to the abandoned party, and leaving it behind would
  // flash (and mis-seed) that party's data (RSVPs, schedule, photo groups) if
  // a different code logs in next.
  const handleNotYourParty = () => {
    clearGuestToken();
    resetGuestQueries(queryClient);
    navigate("/rsvp");
  };

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

  const deadline = data.rsvp_deadline
    ? formatLongDate(data.rsvp_deadline)
    : null;

  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">Thank you!</h1>
      <p className="mt-3 text-muted-foreground">
        Here is what we have for your party.{" "}
        {data.closed ? (
          <>
            The RSVP deadline has passed, so responses can no longer be changed
            online.{" "}
            {data.contact_email ? (
              <>
                Need to make a change? Contact us at{" "}
                <a
                  className="underline underline-offset-2"
                  href={`mailto:${data.contact_email}`}
                >
                  {data.contact_email}
                </a>
                .
              </>
            ) : (
              "Need to make a change? Please reach out to us directly."
            )}
          </>
        ) : deadline ? (
          `You can come back and change your responses any time before ${deadline}.`
        ) : (
          "You can come back and change your responses any time before the deadline."
        )}
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {data.guests.map((guest: RSVPGuest) => (
          <section
            aria-label={guest.full_name}
            className="rounded-lg border border-ink/10 bg-cream p-5"
            key={guest.id}
          >
            <h2 className="text-xl font-semibold">{guest.full_name}</h2>
            {/* A named placeholder keeps its descriptor visible, mirroring
                the form card. An unnamed slot's heading already IS the
                descriptor, so no subtitle. */}
            {isNamedPlaceholder(guest) ? (
              <p className="text-sm text-muted-foreground">
                {guest.placeholder_text}
              </p>
            ) : null}
            <ul className="mt-3 flex flex-col gap-1">
              {guestEntries(data, guest).map(({ event, status }) => (
                <li
                  className="flex flex-wrap items-center justify-between gap-2"
                  key={event.id}
                >
                  <span className="font-medium">{event.name}</span>
                  <span className="text-sm text-muted-foreground">
                    {statusLabel(status)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm">
              <span className="font-medium">Dietary restrictions:</span>{" "}
              {guest.dietary_restrictions || "None"}
            </p>
          </section>
        ))}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button asChild>
          <Link to="/schedule">View the schedule</Link>
        </Button>
        {!data.closed ? (
          <Button asChild variant="outline">
            <Link to="/rsvp/form">Edit your RSVP</Link>
          </Button>
        ) : null}
        <Button onClick={handleNotYourParty} type="button" variant="ghost">
          Not your party?
        </Button>
      </div>
    </section>
  );
}
