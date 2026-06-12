/**
 * Shared display formatting helpers used by both the guest-facing pages and
 * the admin dashboard.
 */

import type { Event } from "@/types/generated/models";
import type { PartyPhotoGroup } from "@/types/generated/photogroups";

/**
 * Converts a stored "HH:MM" wall-clock string to a 12-hour display value
 * ("18:00" becomes "6:00 PM"). Returns the input unchanged if it does not
 * parse, so a bad value is visible rather than hidden.
 */
export function formatTime(time: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) return time;
  const hours = Number(match[1]);
  if (hours > 23) return time;
  const period = hours < 12 ? "AM" : "PM";
  const displayHours = hours % 12 === 0 ? 12 : hours % 12;
  return `${displayHours}:${match[2]} ${period}`;
}

/**
 * Formats an ISO timestamp as a long date ("August 1, 2026") for guest-facing
 * copy such as the RSVP deadline.
 */
export function formatLongDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Friendly display for an event's stored "YYYY-MM-DD" date ("Saturday,
 * October 17, 2026"). Parsed at noon so no timezone can shift the day; falls
 * back to the raw string when it does not parse, so a bad value is visible
 * rather than hidden.
 */
export function formatEventDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(parsed);
}

/**
 * One line saying when an event happens: "Saturday, June 13, 2026 · 5:00 PM"
 * when a start time is set, with "5:00 PM to 10:00 PM" when an end time is
 * too, and just the date when the event has no start time.
 */
export function formatEventWhen(
  event: Pick<Event, "date" | "start_time" | "end_time">,
): string {
  const date = formatEventDate(event.date);
  if (!event.start_time) return date;
  const time = event.end_time
    ? `${formatTime(event.start_time)} to ${formatTime(event.end_time)}`
    : formatTime(event.start_time);
  return `${date} · ${time}`;
}

/**
 * One line of the schedule's photos section: a photo group with its position
 * in the shooting order and the first names of THIS party's guests in it
 * ("Family Photos (group 1 of 3): Leon, Leslie"). First names fit the
 * guest-facing tone, and the viewer only ever sees their own party's guests
 * (matching the InfoCollection greeting's first-name convention). An empty
 * guest list omits the trailing names rather than rendering a dangling colon.
 */
export function formatPhotoGroupLine(group: PartyPhotoGroup): string {
  const label = `${group.name} (group ${group.position} of ${group.total})`;
  const names = group.guest_names.map((name) => name.split(" ")[0]).join(", ");
  return names === "" ? label : `${label}: ${names}`;
}
