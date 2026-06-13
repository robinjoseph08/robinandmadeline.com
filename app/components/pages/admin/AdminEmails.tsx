import { Plus } from "lucide-react";
import { Link } from "react-router-dom";

import { formatSentAt } from "@/components/pages/admin/emails/format";
import { SendStatsSummary } from "@/components/pages/admin/emails/status";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useEmailSends } from "@/hooks/queries/emails";

/**
 * Admin email home: the send history, newest first, each with its delivery
 * stats. Delivery happens in the background (a send returns with everything
 * queued), so the list refetches periodically while open to show statuses
 * progressing. Composing and template management live on sibling pages.
 */
export default function AdminEmails() {
  // Poll so queued -> sent -> delivered progress appears without a manual
  // refresh; 5s matches the worker's poll cadence. Stops once no send has
  // in-flight (queued or sending) recipients left.
  const sendsQuery = useEmailSends({
    refetchInterval: (query) => {
      const items = query.state.data?.items;
      return items === undefined ||
        items.some((send) => send.stats.queued + send.stats.sending > 0)
        ? 5000
        : false;
    },
  });

  const sends = sendsQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Emails</h1>
          <p className="text-sm text-muted-foreground">
            {sendsQuery.data
              ? `${sendsQuery.data.total} send${sendsQuery.data.total === 1 ? "" : "s"}`
              : "Send emails to filtered sets of guests."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/admin/emails/templates">Templates</Link>
          </Button>
          <Button asChild>
            <Link to="/admin/emails/compose">
              <Plus />
              Compose
            </Link>
          </Button>
        </div>
      </div>

      {sendsQuery.isLoading ? (
        <p className="text-muted-foreground">Loading sends...</p>
      ) : sendsQuery.isError ? (
        <p className="text-destructive">{sendsQuery.error.message}</p>
      ) : sends.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing sent yet. Compose the first email to get started.
        </p>
      ) : (
        <div className="rounded-md border border-ink/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Sent</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Delivery</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sends.map((send) => (
                <TableRow key={send.id}>
                  <TableCell className="whitespace-nowrap">
                    {formatSentAt(send.sent_at)}
                  </TableCell>
                  <TableCell>
                    <Link
                      className="font-medium hover:underline"
                      to={`/admin/emails/sends/${send.id}`}
                    >
                      {send.subject}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <SendStatsSummary stats={send.stats} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
