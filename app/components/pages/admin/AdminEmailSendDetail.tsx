import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { formatSentAt } from "@/components/pages/admin/emails/format";
import {
  SendStatsSummary,
  StatusBadge,
} from "@/components/pages/admin/emails/status";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEmailSend } from "@/hooks/queries/emails";

/**
 * One send's detail: the copy as sent, its delivery stats, and the
 * per-recipient delivery breakdown. Polls while any recipient is still in
 * flight (queued or sending) so statuses progress live, and stops once the
 * worker has dispatched everything; the webhook's later sent -> delivered or
 * bounced upgrades arrive on the next focus refetch (polling on `sent` rows
 * would never stop, since a delivery event is not guaranteed).
 */
export default function AdminEmailSendDetail() {
  const { id } = useParams<{ id: string }>();
  const sendQuery = useEmailSend(id, {
    refetchInterval: (query) => {
      const stats = query.state.data?.stats;
      return stats === undefined || stats.queued + stats.sending > 0
        ? 5000
        : false;
    },
  });

  const send = sendQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <Button asChild size="sm" variant="ghost">
          <Link to="/admin/emails">
            <ArrowLeft />
            Send history
          </Link>
        </Button>
      </div>

      {sendQuery.isLoading ? (
        <p className="text-muted-foreground">Loading send...</p>
      ) : sendQuery.isError ? (
        <p className="text-destructive">{sendQuery.error.message}</p>
      ) : send ? (
        <>
          <div>
            <h1 className="text-2xl font-semibold">{send.subject}</h1>
            <p className="text-sm text-muted-foreground">
              Sent {formatSentAt(send.sent_at)} by {send.sent_by}
            </p>
            <p className="mt-1 text-sm">
              <SendStatsSummary stats={send.stats} />
            </p>
          </div>

          <div className="max-w-3xl space-y-1 rounded-md bg-muted/40 p-3">
            <p className="text-xs text-muted-foreground">
              Body as composed (merge fields resolved per recipient):
            </p>
            <p className="whitespace-pre-wrap text-sm">{send.body}</p>
          </div>

          <div>
            <h2 className="mb-2 text-lg font-medium">Recipients</h2>
            <div className="rounded-md border border-ink/10">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Guest</TableHead>
                    <TableHead>Party</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {send.recipients.map((recipient) => (
                    <TableRow key={recipient.id}>
                      <TableCell>{recipient.guest_name}</TableCell>
                      <TableCell>{recipient.party_name}</TableCell>
                      <TableCell>{recipient.email_address}</TableCell>
                      <TableCell>
                        <StatusBadge status={recipient.status} />
                      </TableCell>
                      <TableCell className="max-w-md truncate text-sm text-muted-foreground">
                        {recipient.failure_reason ?? ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
