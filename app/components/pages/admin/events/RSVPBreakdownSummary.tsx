import type { RSVPBreakdown } from "@/types/generated/events";

interface RSVPBreakdownSummaryProps {
  breakdown: RSVPBreakdown;
}

/**
 * Compact per-event RSVP tally: attending / not attending / pending out of the
 * invited total. An Event RSVP row is the invitation (ADR 0002), so the total
 * is also how many guests are invited; zero means nobody is invited yet.
 * Shared by the events list rows and the event detail header.
 */
export function RSVPBreakdownSummary({ breakdown }: RSVPBreakdownSummaryProps) {
  if (breakdown.total === 0) {
    return (
      <span className="text-sm text-muted-foreground">No guests invited</span>
    );
  }
  return (
    <span className="text-sm">
      <span className="font-medium text-green-700">
        {breakdown.attending} attending
      </span>
      <span className="text-muted-foreground"> · </span>
      <span className="font-medium text-red-700">
        {breakdown.not_attending} declined
      </span>
      <span className="text-muted-foreground"> · </span>
      <span className="font-medium text-amber-700">
        {breakdown.pending} pending
      </span>
      <span className="text-muted-foreground">
        {" "}
        of {breakdown.total} invited
      </span>
    </span>
  );
}
