import { Link } from "react-router-dom";

import type { RSVPBreakdown } from "@/types/generated/events";
import type { EventRSVPStatus } from "@/types/generated/models";

interface RSVPBreakdownSummaryProps {
  breakdown: RSVPBreakdown;
  /**
   * Optional destination per status (the dashboard links each count to the
   * guests list filtered to that event and status). Without it the counts are
   * plain text.
   */
  linkFor?: (status: EventRSVPStatus) => string;
}

/**
 * Compact per-event RSVP tally: attending / not attending / pending out of the
 * invited total. An Event RSVP row is the invitation (ADR 0002), so the total
 * is also how many guests are invited; zero means nobody is invited yet.
 * Shared by the events list rows, the event detail header, and the dashboard.
 */
export function RSVPBreakdownSummary({
  breakdown,
  linkFor,
}: RSVPBreakdownSummaryProps) {
  if (breakdown.total === 0) {
    return (
      <span className="text-sm text-muted-foreground">No guests invited</span>
    );
  }
  const count = (status: EventRSVPStatus, text: string) =>
    linkFor ? (
      <Link className="underline-offset-2 hover:underline" to={linkFor(status)}>
        {text}
      </Link>
    ) : (
      text
    );
  return (
    <span className="text-sm">
      <span className="font-medium text-green-700">
        {count("attending", `${breakdown.attending} attending`)}
      </span>
      <span className="text-muted-foreground"> · </span>
      <span className="font-medium text-red-700">
        {count("not_attending", `${breakdown.not_attending} declined`)}
      </span>
      <span className="text-muted-foreground"> · </span>
      <span className="font-medium text-amber-700">
        {count("pending", `${breakdown.pending} pending`)}
      </span>
      <span className="text-muted-foreground">
        {" "}
        of {breakdown.total} invited
      </span>
    </span>
  );
}
