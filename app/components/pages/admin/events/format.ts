import { VENUE_TIME_ZONE } from "@/libraries/venue";
import type { EventResponse } from "@/types/generated/events";

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
 * The venue timezone's abbreviation on a given calendar date ("PST" or "PDT"
 * for Pacific, depending on daylight saving). Event times are venue
 * wall-clock values, so every displayed time carries this label to make the
 * zone explicit.
 */
export function venueTimeZoneAbbreviation(date: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: VENUE_TIME_ZONE,
    timeZoneName: "short",
  }).formatToParts(new Date(`${date}T12:00:00Z`));
  return parts.find((part) => part.type === "timeZoneName")?.value ?? "";
}

/**
 * Formats an event's date plus its optional start/end times for display
 * ("2026-10-17", "2026-10-17 4:00 PM PDT", "2026-10-17 4:00 PM to 10:00 PM
 * PDT", or "2026-10-17 until 10:00 PM PDT" when only an end time is set).
 * Shared by the events list rows and the event detail header. A date with no
 * times carries no zone label; there is no time to disambiguate.
 */
export function formatEventWhen(event: EventResponse): string {
  const zone = venueTimeZoneAbbreviation(event.date);
  if (!event.start_time) {
    return event.end_time
      ? `${event.date} until ${formatTime(event.end_time)} ${zone}`
      : event.date;
  }
  if (!event.end_time) {
    return `${event.date} ${formatTime(event.start_time)} ${zone}`;
  }
  return `${event.date} ${formatTime(event.start_time)} to ${formatTime(event.end_time)} ${zone}`;
}
