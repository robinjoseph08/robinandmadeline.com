import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePartyRSVPs, useUpdatePartyRSVPs } from "@/hooks/queries/rsvp";
import {
  ApiError,
  clearGuestToken,
  readGuestToken,
} from "@/libraries/guest-api";
import type { EventRSVPStatus } from "@/types/generated/models";
import type {
  PartyRSVPsResponse,
  RSVPEventGroup,
  RSVPGuest,
  UpdatePartyRSVPsPayload,
} from "@/types/generated/rsvps";

/**
 * The RSVP form: every guest in the authenticated party, with an
 * attending/not-attending toggle per event they are invited to, an editable
 * name for placeholder guests, and a dietary restrictions field per guest. The
 * whole form submits at once. After the RSVP deadline the same data renders
 * read-only with a "contact us" message instead.
 */
export default function RSVPForm() {
  const hasToken = readGuestToken() !== null;
  const { data, error, isPending } = usePartyRSVPs({ enabled: hasToken });

  if (!hasToken) {
    return <Navigate replace to="/rsvp" />;
  }
  if (error?.status === 401) {
    // The stored token expired or was revoked: back to code entry.
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

  return data.closed ? (
    <ClosedRSVPView data={data} />
  ) : (
    <EditableRSVPForm data={data} />
  );
}

/** A guest's invited events: the groups holding an Event RSVP row for them. */
function invitedEvents(
  data: PartyRSVPsResponse,
  guest: RSVPGuest,
): RSVPEventGroup[] {
  return data.events.filter((event) =>
    event.rsvps.some((entry) => entry.guest_id === guest.id),
  );
}

/** The composite key the form's status state is indexed by. */
function entryKey(eventId: string, guestId: string): string {
  return `${eventId}:${guestId}`;
}

/** Human label for a stored status, for the read-only views. */
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

/** Friendly display for an event's date (falls back to the raw string). */
function formatEventDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

interface RSVPViewProps {
  data: PartyRSVPsResponse;
}

function EditableRSVPForm({ data }: RSVPViewProps) {
  const navigate = useNavigate();
  const updateRSVPs = useUpdatePartyRSVPs();
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Form state, seeded from the fetched data once at mount (the component
  // only renders with data in hand). Statuses are keyed by (event, guest);
  // names and dietary notes by guest.
  const [statuses, setStatuses] = useState<Record<string, EventRSVPStatus>>(
    () => {
      const initial: Record<string, EventRSVPStatus> = {};
      for (const event of data.events) {
        for (const entry of event.rsvps) {
          initial[entryKey(event.id, entry.guest_id)] = entry.status;
        }
      }
      return initial;
    },
  );
  const [names, setNames] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const guest of data.guests) {
      // Placeholder name fields start blank: "Guest of Alice" is the admin's
      // stand-in label, not a prefill the party should have to erase.
      initial[guest.id] = guest.is_placeholder ? "" : guest.full_name;
    }
    return initial;
  });
  const [dietary, setDietary] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const guest of data.guests) {
      initial[guest.id] = guest.dietary_restrictions ?? "";
    }
    return initial;
  });

  function toggleStatus(
    eventId: string,
    guestId: string,
    next: EventRSVPStatus,
  ) {
    const key = entryKey(eventId, guestId);
    setStatuses((prev) => ({
      ...prev,
      // Clicking the already-selected answer withdraws it (back to pending).
      [key]: prev[key] === next ? "pending" : next,
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError(null);

    const payload: UpdatePartyRSVPsPayload = {
      guests: data.guests.map((guest) => ({
        guest_id: guest.id,
        full_name:
          guest.is_placeholder && names[guest.id]?.trim()
            ? names[guest.id].trim()
            : undefined,
        dietary_restrictions: dietary[guest.id]?.trim() || undefined,
        rsvps: invitedEvents(data, guest).map((eventGroup) => ({
          event_id: eventGroup.id,
          status: statuses[entryKey(eventGroup.id, guest.id)] ?? "pending",
        })),
      })),
    };

    try {
      await updateRSVPs.mutateAsync(payload);
      navigate("/rsvp/confirmation");
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setSubmitError(
          "The RSVP deadline has passed, so responses can no longer be changed online.",
        );
      } else {
        setSubmitError(
          "Something went wrong saving your RSVP. Please try again.",
        );
      }
    }
  }

  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">RSVP</h1>
      <p className="mt-3 text-muted-foreground">
        Responding for {data.party_name}.
        {data.rsvp_deadline
          ? ` Please respond by ${new Intl.DateTimeFormat("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            }).format(new Date(data.rsvp_deadline))}.`
          : null}
      </p>

      {data.events.length === 0 ? (
        <p className="mt-6 text-muted-foreground">
          There is nothing to respond to yet. Check back once the schedule is
          out!
        </p>
      ) : (
        <form className="mt-6 flex flex-col gap-6" onSubmit={handleSubmit}>
          {data.guests.map((guest) => (
            <section
              aria-label={guest.full_name}
              className="rounded-lg border border-ink/10 bg-cream p-5"
              key={guest.id}
            >
              <h2 className="text-xl font-semibold">{guest.full_name}</h2>

              {guest.is_placeholder ? (
                <div className="mt-3 flex flex-col gap-1.5">
                  <Label htmlFor={`name-${guest.id}`}>Name</Label>
                  <Input
                    id={`name-${guest.id}`}
                    onChange={(e) =>
                      setNames((prev) => ({
                        ...prev,
                        [guest.id]: e.target.value,
                      }))
                    }
                    placeholder="Their full name"
                    type="text"
                    value={names[guest.id] ?? ""}
                  />
                </div>
              ) : null}

              <div className="mt-4 flex flex-col gap-3">
                {invitedEvents(data, guest).map((eventGroup) => {
                  const current =
                    statuses[entryKey(eventGroup.id, guest.id)] ?? "pending";
                  return (
                    <div
                      className="flex flex-wrap items-center justify-between gap-2"
                      key={eventGroup.id}
                    >
                      <div>
                        <p className="font-medium">{eventGroup.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatEventDate(eventGroup.date)}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          aria-label={`${eventGroup.name}: attending`}
                          aria-pressed={current === "attending"}
                          onClick={() =>
                            toggleStatus(eventGroup.id, guest.id, "attending")
                          }
                          size="sm"
                          type="button"
                          variant={
                            current === "attending" ? "default" : "outline"
                          }
                        >
                          Attending
                        </Button>
                        <Button
                          aria-label={`${eventGroup.name}: not attending`}
                          aria-pressed={current === "not_attending"}
                          onClick={() =>
                            toggleStatus(
                              eventGroup.id,
                              guest.id,
                              "not_attending",
                            )
                          }
                          size="sm"
                          type="button"
                          variant={
                            current === "not_attending" ? "default" : "outline"
                          }
                        >
                          Not attending
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex flex-col gap-1.5">
                <Label htmlFor={`dietary-${guest.id}`}>
                  Dietary restrictions
                </Label>
                <Textarea
                  id={`dietary-${guest.id}`}
                  onChange={(e) =>
                    setDietary((prev) => ({
                      ...prev,
                      [guest.id]: e.target.value,
                    }))
                  }
                  placeholder="Allergies, restrictions, or anything we should know"
                  value={dietary[guest.id] ?? ""}
                />
              </div>
            </section>
          ))}

          {submitError ? (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          ) : null}

          <Button disabled={updateRSVPs.isPending} type="submit">
            {updateRSVPs.isPending ? "Submitting..." : "Submit RSVP"}
          </Button>
        </form>
      )}
    </section>
  );
}

/**
 * The post-deadline view: the party's current responses, read-only, plus a
 * "contact us" message (with the configured contact email when one is set).
 */
function ClosedRSVPView({ data }: RSVPViewProps) {
  const guestNames = new Map(
    data.guests.map((guest) => [guest.id, guest.full_name]),
  );

  return (
    <section className="mx-auto max-w-2xl py-8">
      <h1 className="text-3xl font-bold">RSVP</h1>
      <p className="mt-3 text-muted-foreground" role="status">
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
      </p>

      <div className="mt-6 flex flex-col gap-6">
        {data.events.map((eventGroup) => (
          <section
            aria-label={eventGroup.name}
            className="rounded-lg border border-ink/10 bg-cream p-5"
            key={eventGroup.id}
          >
            <h2 className="text-xl font-semibold">{eventGroup.name}</h2>
            <p className="text-sm text-muted-foreground">
              {formatEventDate(eventGroup.date)}
            </p>
            <ul className="mt-3 flex flex-col gap-1">
              {eventGroup.rsvps.map((entry) => (
                <li
                  className="flex items-center justify-between"
                  key={entry.guest_id}
                >
                  <span>{guestNames.get(entry.guest_id)}</span>
                  <span className="text-sm text-muted-foreground">
                    {statusLabel(entry.status)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
