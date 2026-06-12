import { Badge } from "@/components/ui/badge";
import type { SendStats } from "@/types/generated/emails";
import type { EmailRecipientStatus } from "@/types/generated/models";

/**
 * Shared presentation helpers for email delivery statuses: a per-recipient
 * status badge and the compact per-send stats summary used by the history
 * list and the send detail header.
 */

const STATUS_LABELS: Record<EmailRecipientStatus, string> = {
  queued: "Queued",
  sending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  bounced: "Bounced",
  failed: "Failed",
};

const STATUS_VARIANTS: Record<
  EmailRecipientStatus,
  "default" | "secondary" | "success" | "destructive" | "outline"
> = {
  queued: "outline",
  sending: "secondary",
  sent: "default",
  delivered: "success",
  bounced: "destructive",
  failed: "destructive",
};

/** A recipient's delivery status as a colored badge. */
export function StatusBadge({ status }: { status: EmailRecipientStatus }) {
  return (
    <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>
  );
}

/**
 * One send's delivery stats as a compact "3 delivered, 1 bounced of 4
 * recipients" summary, listing only the statuses that occur.
 */
export function SendStatsSummary({ stats }: { stats: SendStats }) {
  const parts = (
    [
      ["queued", stats.queued],
      ["sending", stats.sending],
      ["sent", stats.sent],
      ["delivered", stats.delivered],
      ["bounced", stats.bounced],
      ["failed", stats.failed],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `${count} ${label}`);

  if (stats.total === 0) {
    return <span className="text-muted-foreground">No recipients</span>;
  }
  return (
    <span>
      {parts.join(", ")}{" "}
      <span className="text-muted-foreground">
        of {stats.total} recipient{stats.total === 1 ? "" : "s"}
      </span>
    </span>
  );
}
