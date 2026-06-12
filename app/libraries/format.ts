/**
 * Shared display formatting helpers used by both the guest-facing pages and
 * the admin dashboard.
 */

import type { SchedulePhotoGroup } from "@/types/generated/events";
import type { Event } from "@/types/generated/models";

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
 * Joins values in prose: "3", "3 and 5", "2, 5, and 7".
 */
function joinWithAnd(values: string[]): string {
  if (values.length <= 1) return values.join("");
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

/**
 * The schedule's photo-group line for one event: the groups someone in the
 * authenticated guest's party is in, with each group's position in the
 * event's shooting order ("Stay for photos! You're in: Bride's Family.
 * Group 3 of 12."). Positions and the total span all of the event's groups,
 * so the guest knows how far down the photographer's list they are. Returns
 * an empty string when there are no groups; the caller renders nothing.
 */
export function formatPhotoGroupsLine(groups: SchedulePhotoGroup[]): string {
  if (groups.length === 0) return "";
  const names = groups.map((g) => g.name).join(", ");
  const positions = joinWithAnd(groups.map((g) => String(g.position)));
  const label = groups.length === 1 ? "Group" : "Groups";
  return `Stay for photos! You're in: ${names}. ${label} ${positions} of ${groups[0].total}.`;
}
