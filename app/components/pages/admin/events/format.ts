import type { EventResponse } from "@/types/generated/events";

/**
 * Formats an event's date plus its optional start/end times for display
 * ("2026-10-17", "2026-10-17 16:00", "2026-10-17 16:00 to 22:00", or
 * "2026-10-17 until 22:00" when only an end time is set). Shared by the events
 * list rows and the event detail header.
 */
export function formatEventWhen(event: EventResponse): string {
  if (!event.start_time) {
    return event.end_time
      ? `${event.date} until ${event.end_time}`
      : event.date;
  }
  if (!event.end_time) return `${event.date} ${event.start_time}`;
  return `${event.date} ${event.start_time} to ${event.end_time}`;
}
