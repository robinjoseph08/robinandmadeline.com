/**
 * "Add to Calendar" helpers for schedule events: a Google Calendar template
 * link and an .ics (RFC 5545) file download, both built entirely on the
 * client from the event's stored fields (no backend endpoint).
 *
 * Event times are the venue's wall-clock values (a "YYYY-MM-DD" date plus
 * optional "HH:MM" start/end), so both outputs carry local times pinned to
 * VENUE_TIME_ZONE (the `ctz` query param for Google, a TZID plus VTIMEZONE
 * definition for .ics) and leave the daylight-saving math to the consuming
 * calendar. An event with no start time becomes an all-day event; a missing
 * end time defaults to one hour after the start; an end time before the start
 * is read as running past midnight into the next day.
 */

import { VENUE_TIME_ZONE } from "@/libraries/venue";
import type { Event } from "@/types/generated/models";

const MINUTES_PER_DAY = 24 * 60;

/**
 * The RFC 5545 timezone definition for VENUE_TIME_ZONE, so the TZID the
 * events reference resolves even in strict parsers. These are America/
 * Chicago's rules (CST/CDT, second Sunday of March to first Sunday of
 * November); if VENUE_TIME_ZONE ever changes, this block must change with it.
 */
const VENUE_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${VENUE_TIME_ZONE}`,
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:-0600",
  "TZOFFSETTO:-0500",
  "TZNAME:CDT",
  "DTSTART:19700308T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:-0500",
  "TZOFFSETTO:-0600",
  "TZNAME:CST",
  "DTSTART:19701101T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** "2026-10-17" -> "20261017" (the iCalendar basic date format). */
function basicDate(date: string): string {
  return date.replace(/-/g, "");
}

/** ("20261017", "17:00") -> "20261017T170000" (basic local date-time). */
function basicDateTime(date: string, time: string): string {
  return `${basicDate(date)}T${time.replace(":", "")}00`;
}

/** Shifts a "YYYY-MM-DD" date by whole days (UTC math, so no DST surprises). */
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

/** "HH:MM" -> minutes since midnight. */
function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Minutes since midnight -> "HH:MM" (caller keeps it under one day). */
function fromMinutes(total: number): string {
  const hours = String(Math.floor(total / 60)).padStart(2, "0");
  const minutes = String(total % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * Where a timed event ends, as a venue-local (date, time) pair. A stored end
 * before the start reads as past midnight (a reception running into the small
 * hours); a missing end defaults to one hour after the start, which can also
 * roll the date.
 */
function eventEnd(date: string, start: string, end?: string): [string, string] {
  const startMinutes = toMinutes(start);
  // A missing end arrives as JSON null at runtime even though the generated
  // type says `?: string` (Go marshals a nil *string as null), so test
  // truthiness rather than === undefined.
  let endMinutes = end ? toMinutes(end) : startMinutes + 60;
  if (endMinutes < startMinutes) {
    endMinutes += MINUTES_PER_DAY;
  }
  return [
    addDays(date, Math.floor(endMinutes / MINUTES_PER_DAY)),
    fromMinutes(endMinutes % MINUTES_PER_DAY),
  ];
}

/**
 * The Google Calendar "add event" template link for one event. Timed events
 * carry venue-local times plus `ctz`, all-day events the date-only format
 * with the exclusive next-day end.
 */
export function googleCalendarUrl(event: Event): string {
  const params = new URLSearchParams({ action: "TEMPLATE", text: event.name });

  if (event.start_time) {
    const [endDate, endTime] = eventEnd(
      event.date,
      event.start_time,
      event.end_time,
    );
    const start = basicDateTime(event.date, event.start_time);
    params.set("dates", `${start}/${basicDateTime(endDate, endTime)}`);
    params.set("ctz", VENUE_TIME_ZONE);
  } else {
    params.set(
      "dates",
      `${basicDate(event.date)}/${basicDate(addDays(event.date, 1))}`,
    );
  }

  if (event.description) params.set("details", event.description);
  if (event.location) params.set("location", event.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Escapes a text value per RFC 5545 (backslash, semicolon, comma) and folds
 * every newline form (CRLF, lone LF, lone CR) to the escaped \n, since a raw
 * CR or LF inside a content line is invalid iCalendar.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** A Date as the UTC basic date-time iCalendar stamps require. */
function utcStamp(at: Date): string {
  return `${at.toISOString().slice(0, 19).replace(/[-:]/g, "")}Z`;
}

/**
 * The complete .ics file body for one event. `now` feeds DTSTAMP and exists
 * as a parameter for deterministic tests. Lines are CRLF-joined per RFC 5545;
 * they are not folded at 75 octets (a SHOULD, and every mainstream calendar
 * client accepts long lines).
 */
export function icsContent(event: Event, now: Date = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Robin & Madeline//Wedding Schedule//EN",
    "CALSCALE:GREGORIAN",
  ];

  // The timezone definition is only needed when an event references local
  // times; an all-day event has no wall-clock to pin.
  if (event.start_time) {
    lines.push(...VENUE_VTIMEZONE);
  }

  lines.push(
    "BEGIN:VEVENT",
    `UID:${event.id}@robinandmadeline.com`,
    `DTSTAMP:${utcStamp(now)}`,
  );

  if (event.start_time) {
    const [endDate, endTime] = eventEnd(
      event.date,
      event.start_time,
      event.end_time,
    );
    lines.push(
      `DTSTART;TZID=${VENUE_TIME_ZONE}:${basicDateTime(event.date, event.start_time)}`,
      `DTEND;TZID=${VENUE_TIME_ZONE}:${basicDateTime(endDate, endTime)}`,
    );
  } else {
    lines.push(
      `DTSTART;VALUE=DATE:${basicDate(event.date)}`,
      `DTEND;VALUE=DATE:${basicDate(addDays(event.date, 1))}`,
    );
  }

  lines.push(`SUMMARY:${escapeText(event.name)}`);
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");

  return `${lines.join("\r\n")}\r\n`;
}

/** A filesystem-friendly download name derived from the event's name. */
export function icsFilename(event: Event): string {
  const slug = event.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "event"}.ics`;
}

/** Builds the .ics file in memory and triggers a browser download of it. */
export function downloadICS(event: Event): void {
  const blob = new Blob([icsContent(event)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = icsFilename(event);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking in the same task as the click has intermittently cancelled the
  // download in Safari, so leave the blob URL alive long enough for any
  // browser to have started reading it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
