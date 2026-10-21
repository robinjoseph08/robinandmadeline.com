import { ArrowLeft, RotateCw } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import type { ComposePrefill } from "@/components/pages/admin/emails/compose-prefill";
import { formatSentAt } from "@/components/pages/admin/emails/format";
import {
  SendStatsSummary,
  StatusBadge,
} from "@/components/pages/admin/emails/status";
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
import { useEmailSend } from "@/hooks/queries/emails";
import { useAdminPageTitle } from "@/hooks/usePageTitle";
import type { SendDetailResponse } from "@/types/generated/emails";
import {
  EmailQueued,
  EmailSending,
  type EmailRecipientStatus,
} from "@/types/generated/models";

/** Whether a recipient row is still waiting on the worker to dispatch it. */
function inFlight(status: EmailRecipientStatus): boolean {
  return status === EmailQueued || status === EmailSending;
}

/**
 * The compose draft for resending a send to one of its guests: the same copy
 * and template, addressed to just that guest. The send's events carry over so
 * {{event_name}}/{{event_date}} render as they did the first time. The new send
 * reads the guest as they are now, so a corrected name or email address is
 * what goes out.
 */
function resendPrefill(
  send: SendDetailResponse,
  guestId: string,
): ComposePrefill {
  return {
    templateId: send.template_id,
    subject: send.subject,
    body: send.body,
    filter: {
      guest_ids: [guestId],
      event_ids: send.recipient_filter.event_ids,
    },
  };
}

/**
 * One send's detail: the copy as sent, its delivery stats, and the
 * per-recipient delivery breakdown. Polls while any recipient is still in
 * flight (queued or sending) so statuses progress live, and stops once the
 * worker has dispatched everything (polling on `sent` rows would never stop,
 * since a delivery event is not guaranteed). The webhook's later sent ->
 * delivered or bounced upgrades arrive on window focus instead, overriding
 * the app-wide refetchOnWindowFocus: false, so returning to the tab shows
 * current statuses.
 */
export default function AdminEmailSendDetail() {
  const { id } = useParams<{ id: string }>();
  const sendQuery = useEmailSend(id, {
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const stats = query.state.data?.stats;
      return stats === undefined || stats.queued + stats.sending > 0
        ? 5000
        : false;
    },
  });

  const send = sendQuery.data;
  useAdminPageTitle(send?.subject);

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
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{send.subject}</h1>
              {send.is_test && <Badge variant="secondary">Test send</Badge>}
            </div>
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
                    {!send.is_test && (
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    )}
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
                      {/* A test send went to the couple's own inboxes, so
                          there is no guest to resend it to. */}
                      {!send.is_test && (
                        <TableCell className="text-right">
                          {/* A row still queued or sending is about to go out
                              anyway; resending it would only duplicate it. */}
                          {!inFlight(recipient.status) && (
                            <Button asChild size="sm" variant="ghost">
                              <Link
                                aria-label={`Resend to ${recipient.guest_name}`}
                                state={{
                                  prefill: resendPrefill(
                                    send,
                                    recipient.guest_id,
                                  ),
                                }}
                                to="/admin/emails/compose"
                              >
                                <RotateCw />
                                Resend
                              </Link>
                            </Button>
                          )}
                        </TableCell>
                      )}
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
