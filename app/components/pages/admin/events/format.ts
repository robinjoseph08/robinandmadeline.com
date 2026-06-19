import { formatTime, venueTimeZoneAbbreviation } from "@/libraries/format";
import type { EventResponse } from "@/types/generated/events";

/**
 * Formats an event's date plus its optional start/end times for display
 * ("2026-10-17", "2026-10-17 4:00 PM CDT", "2026-10-17 4:00 PM to 10:00 PM
 * CDT", or "2026-10-17 until 10:00 PM CDT" when only an end time is set).
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
