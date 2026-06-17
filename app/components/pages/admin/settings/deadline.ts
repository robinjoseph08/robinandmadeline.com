/**
 * Helpers for the RSVP deadline app setting, which is stored as an RFC3339
 * timestamp (pkg/models.AppSettingRSVPDeadline) but edited on the settings page
 * as a plain calendar date.
 *
 * The deadline's domain meaning is "RSVPs are open through the end of this
 * day": the RSVP reader closes the window only for moments strictly after the
 * stored instant (pkg/rsvps `closed`). So a picked date maps to the last second
 * of that UTC day, and a stored timestamp maps back to its UTC date for the
 * picker. UTC throughout keeps the round-trip exact and free of the local-zone
 * drift a naive `new Date(date)` would introduce.
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Converts a picked "YYYY-MM-DD" date to the stored RFC3339 timestamp, the end
 * of that day in UTC ("2026-08-01" -> "2026-08-01T23:59:59Z"), so RSVPs stay
 * open through the whole chosen day. Returns null for a blank or malformed
 * date, which the caller sends as the clear gesture.
 */
export function dateToDeadline(date: string): string | null {
  if (!ISO_DATE_RE.test(date)) return null;
  return `${date}T23:59:59Z`;
}

/**
 * Converts a stored RFC3339 deadline back to the "YYYY-MM-DD" value the date
 * input shows, using the timestamp's UTC date so it matches what
 * `dateToDeadline` wrote. Returns "" for a null/unset or unparseable value, so
 * the input renders empty.
 */
export function deadlineToDate(deadline: string | null | undefined): string {
  if (!deadline) return "";
  const parsed = new Date(deadline);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}
