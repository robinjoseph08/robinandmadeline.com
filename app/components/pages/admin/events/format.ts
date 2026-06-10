import type { EventResponse } from "@/types/generated/events";

/**
 * Formats an event's date plus its optional start/end times for display
 * ("2026-10-17", "2026-10-17 16:00", or "2026-10-17 16:00 to 22:00"). Shared
 * by the events list rows and the event detail header.
 */
export function formatEventWhen(event: EventResponse): string {
  if (!event.start_time) return event.date;
  if (!event.end_time) return `${event.date} ${event.start_time}`;
  return `${event.date} ${event.start_time} to ${event.end_time}`;
}
