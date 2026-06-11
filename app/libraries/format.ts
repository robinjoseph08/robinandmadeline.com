/**
 * Shared display formatting helpers used by both the guest-facing pages and
 * the admin dashboard.
 */

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
