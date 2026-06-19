/**
 * Shared display formatting helpers used by both the guest-facing pages and
 * the admin dashboard.
 */

import { VENUE_TIME_ZONE } from "@/libraries/venue";
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
 * The venue timezone's abbreviation on a given calendar date ("CST" or "CDT"
 * for Central, depending on daylight saving). Event times are venue wall-clock
 * values, so a displayed time can carry this label to make the zone explicit
 * for guests reading from another timezone. Empty string if the runtime cannot
 * resolve a short name.
 */
export function venueTimeZoneAbbreviation(date: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VENUE_TIME_ZONE,
    timeZoneName: "short",
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

/**
 * Formats an ISO timestamp as a readable date and time ("Oct 17, 2026, 4:05
 * PM") for admin tables such as the crossword solve-times list. Falls back to
 * the raw string when it does not parse, so a bad value is visible rather than
 * hidden.
 */
export function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(parsed);
}

/**
 * Formats a duration in milliseconds as a clock readout for the crossword
 * timer and leaderboard: "0:07", "12:05", or "1:02:03" once it passes an
 * hour. Sub-second remainders truncate (a solve shows 0:00 until a full
 * second has passed).
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}

/**
 * The time portion of an event, labeled with the venue timezone ("5:00 PM to
 * 10:00 PM CDT", or "5:00 PM CDT" with no end), or null when the event has no
 * start time (an all-day event shown by date alone). Event times are venue
 * wall-clock values, so the zone label disambiguates them for a guest reading
 * from another timezone. Splitting the time out from formatEventWhen lets the
 * schedule card stack the date and time on separate lines while formatEventWhen
 * keeps them on one.
 */
export function formatEventTime(
  event: Pick<Event, "date" | "start_time" | "end_time">,
): string | null {
  if (!event.start_time) return null;
  const range = event.end_time
    ? `${formatTime(event.start_time)} to ${formatTime(event.end_time)}`
    : formatTime(event.start_time);
  const zone = venueTimeZoneAbbreviation(event.date);
  return zone ? `${range} ${zone}` : range;
}

/**
 * One line saying when an event happens: "Saturday, June 13, 2026 · 5:00 PM
 * CDT" when a start time is set, with "5:00 PM to 10:00 PM CDT" when an end
 * time is too, and just the date (no zone) when the event has no start time.
 */
export function formatEventWhen(
  event: Pick<Event, "date" | "start_time" | "end_time">,
): string {
  const date = formatEventDate(event.date);
  const time = formatEventTime(event);
  return time ? `${date} · ${time}` : date;
}

/**
 * The first names of a photo group's guests, joined for display ("Leon,
 * Leslie"). First names fit the guest-facing tone, and the viewer only ever
 * sees their own party's guests (matching the InfoCollection greeting's
 * first-name convention). The Group Photos cards on the schedule carry the
 * rest of the structure (group name, position badge) in markup.
 */
export function formatGuestFirstNames(names: string[]): string {
  return names.map((name) => name.split(" ")[0]).join(", ");
}
