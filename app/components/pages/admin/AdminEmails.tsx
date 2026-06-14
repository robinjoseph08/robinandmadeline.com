import { Plus } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { formatSentAt } from "@/components/pages/admin/emails/format";
import { SendStatsSummary } from "@/components/pages/admin/emails/status";
import { Badge } from "@/components/ui/badge";
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

// The send-history view filter: every send, only real sends, or only test
// sends. Applied on the frontend over the already-fetched list, so switching is
// instant and needs no refetch.
type SendFilter = "all" | "real" | "tests";

const FILTER_OPTIONS: { value: SendFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "real", label: "Real" },
  { value: "tests", label: "Tests" },
];

/**
 * Admin email home: the send history, newest first, each with its delivery
 * stats. Delivery happens in the background (a send returns with everything
 * queued), so the list refetches periodically while open to show statuses
 * progressing. A frontend filter narrows the list to real or test sends (test
 * sends are real sends to the couple's own inboxes, flagged so they stay
 * distinguishable). Composing and template management live on sibling pages.
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

  const [filter, setFilter] = useState<SendFilter>("all");

  const sends = sendsQuery.data?.items ?? [];
  const visibleSends = sends.filter((send) => {
    if (filter === "real") return !send.is_test;
    if (filter === "tests") return send.is_test;
    return true;
  });

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
        <div className="space-y-3">
          {/* Segmented filter over the fetched list: All / Real / Tests. */}
          <div
            aria-label="Filter sends"
            className="flex w-fit gap-1 rounded-md border border-input p-0.5"
            role="group"
          >
            {FILTER_OPTIONS.map((option) => (
              <Button
                aria-pressed={filter === option.value}
                key={option.value}
                onClick={() => setFilter(option.value)}
                size="sm"
                variant={filter === option.value ? "default" : "ghost"}
              >
                {option.label}
              </Button>
            ))}
          </div>

          {visibleSends.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No {filter === "tests" ? "test" : "real"} sends yet.
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
                  {visibleSends.map((send) => (
                    <TableRow key={send.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatSentAt(send.sent_at)}
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <Link
                            className="font-medium hover:underline"
                            to={`/admin/emails/sends/${send.id}`}
                          >
                            {send.subject}
                          </Link>
                          {send.is_test && (
                            <Badge variant="secondary">Test</Badge>
                          )}
                        </span>
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
      )}
    </div>
  );
}
