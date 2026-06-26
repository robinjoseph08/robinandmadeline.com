import { AlertTriangle, Loader2, Send } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { ChipsCombobox } from "@/components/library/ChipsCombobox";
import { Combobox } from "@/components/library/Combobox";
import { MERGE_FIELDS_HINT } from "@/components/pages/admin/emails/merge-fields";
import { FilterSelect } from "@/components/pages/admin/parties/FilterSelect";
import {
  CIRCLE_OPTIONS,
  INFO_STATUS_OPTIONS,
  INVITATION_TYPE_OPTIONS,
  RELATION_OPTIONS,
  RSVP_STATUS_OPTIONS,
  SIDE_OPTIONS,
} from "@/components/pages/admin/parties/options";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useEmailTemplates,
  usePreviewEmail,
  useSendEmail,
  useSendTestEmail,
} from "@/hooks/queries/emails";
import { useEvents } from "@/hooks/queries/events";
import { useParties } from "@/hooks/queries/parties";
import { useAdminPageTitle } from "@/hooks/usePageTitle";
import type { PreviewEmailResponse } from "@/types/generated/emails";
import type {
  Circle,
  EventRSVPStatus,
  InfoCollectionStatus,
  InvitationType,
  RecipientFilter,
  Relation,
  Side,
} from "@/types/generated/models";

interface FilterState {
  side?: Side;
  relation?: Relation;
  circle?: Circle;
  tags: string[];
  eventId?: string;
  rsvpStatus?: EventRSVPStatus;
  invitationType?: InvitationType;
  infoCollectionStatus?: InfoCollectionStatus;
}

const EMPTY_FILTER: FilterState = { tags: [] };

/**
 * When the recipient count exceeds what is left of today's daily send budget,
 * describes roughly how many days the queue will take to drain (the worker
 * dispatches up to the limit per UTC day and the rest simply waits).
 * Undefined when the limit is unlimited (zero) or today's remaining budget
 * covers the whole send.
 */
function multiDaySendNote(preview: PreviewEmailResponse): string | undefined {
  const limit = preview.daily_send_limit;
  if (limit <= 0) return undefined;
  const remainingToday = Math.max(limit - preview.daily_sends_used, 0);
  if (preview.total <= remainingToday) return undefined;
  // Today only counts as a day when it still contributes sends: with the
  // budget already spent, the queue drains entirely on later days, so adding
  // one for today would overstate the estimate.
  const days =
    remainingToday === 0
      ? Math.ceil(preview.total / limit)
      : Math.ceil((preview.total - remainingToday) / limit) + 1;
  return `The daily send limit is ${limit} (${preview.daily_sends_used} used today), so it will go out over approximately ${days} day${days === 1 ? "" : "s"}.`;
}

/** Builds the wire filter, dropping unset criteria. */
function toRecipientFilter(filter: FilterState): RecipientFilter {
  return {
    side: filter.side,
    relation: filter.relation,
    circle: filter.circle,
    tags: filter.tags.length > 0 ? filter.tags : undefined,
    event_id: filter.eventId,
    rsvp_status: filter.rsvpStatus,
    invitation_type: filter.invitationType,
    info_collection_status: filter.infoCollectionStatus,
  };
}

/**
 * Compose page: start from a template (or blank), edit the subject and body,
 * narrow the recipients with the guest filters, preview the resolved merge
 * fields for a sample recipient, and send. Sending always re-resolves the
 * recipient count and asks for confirmation with it in a deliberate modal, so
 * the number confirmed is never stale and a reflexive click or Enter cannot
 * dispatch it; the actual delivery happens in the background and the page
 * navigates to the send's detail to watch it progress.
 */
export default function AdminEmailCompose() {
  useAdminPageTitle("Compose Email");
  const navigate = useNavigate();
  const templatesQuery = useEmailTemplates();
  const eventsQuery = useEvents();
  const partiesQuery = useParties({});
  const previewEmail = usePreviewEmail();
  const sendEmail = useSendEmail();
  const sendTestEmail = useSendTestEmail();

  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [preview, setPreview] = useState<PreviewEmailResponse | undefined>(
    undefined,
  );
  // True while the pre-send audience re-resolve is in flight (before the
  // confirmation dialog opens): the count round-trip leaves a window where
  // sendEmail.isPending is still false, and a second Send click there would
  // re-resolve (and ultimately dispatch the bulk send) twice.
  const [sending, setSending] = useState(false);
  // Whether the deliberate send-confirmation dialog is open. It replaces the
  // old native window.confirm so a reflexive Enter cannot dismiss it into a
  // send; the explicit, labeled confirm button is the only path to dispatch.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const templates = templatesQuery.data?.items ?? [];
  const events = eventsQuery.data?.items ?? [];

  const templateOptions = templates.map((t) => ({
    value: t.id,
    label: t.name,
  }));
  const eventOptions = events.map((e) => ({ value: e.id, label: e.name }));

  // Distinct tags across all guests, for the multi-select tag filter. The
  // parties query already loads each party's guests, so this needs no extra
  // fetch; tags are open-ended, so the options are whatever is currently used.
  const tagValues = useMemo(() => {
    const seen = new Set<string>();
    const values: string[] = [];
    for (const party of partiesQuery.data?.items ?? []) {
      for (const guest of party.guests ?? []) {
        for (const tag of guest.tags) {
          const key = tag.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            values.push(tag);
          }
        }
      }
    }
    return values.sort((a, b) => a.localeCompare(b));
  }, [partiesQuery.data]);

  const canCompose = subject.trim().length > 0 && body.length > 0;
  const previewDayNote = preview ? multiDaySendNote(preview) : undefined;
  // The confirmation dialog reads its recipient count and notes from `preview`,
  // which handleSend refreshes (via the pre-send re-resolve) immediately before
  // opening the dialog, so what it shows is the live audience that will send.
  const confirmTotal = preview?.total ?? 0;
  const confirmSkippedNote = (() => {
    if (!preview) return undefined;
    const notes: string[] = [];
    if (preview.skipped_no_email > 0) {
      notes.push(
        `${preview.skipped_no_email} matching guest${preview.skipped_no_email === 1 ? "" : "s"} without an email will be skipped.`,
      );
    }
    if (preview.skipped_unsubscribed > 0) {
      notes.push(
        `${preview.skipped_unsubscribed} unsubscribed guest${preview.skipped_unsubscribed === 1 ? "" : "s"} will be skipped.`,
      );
    }
    return notes.length > 0 ? notes.join(" ") : undefined;
  })();
  // A preview with merge-field warnings means the send would contain a blank
  // field, which the backend hard-refuses; disable Send until it is resolved.
  // The backend always sends warnings as [] (never null), but guard defensively
  // since this gates the Send button.
  const hasWarnings = (preview?.warnings?.length ?? 0) > 0;

  const selectTemplate = (id: string | undefined) => {
    setTemplateId(id);
    setPreview(undefined);
    if (id === undefined) return;
    const template = templates.find((t) => t.id === id);
    if (template) {
      setSubject(template.subject);
      setBody(template.body);
    }
  };

  const updateFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K],
  ) => {
    setFilter((prev) => ({ ...prev, [key]: value }));
    // A changed audience invalidates the shown preview.
    setPreview(undefined);
  };

  const handlePreview = async () => {
    try {
      const result = await previewEmail.mutateAsync({
        subject: subject.trim(),
        body,
        filter: toRecipientFilter(filter),
      });
      setPreview(result);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to preview email",
      );
    }
  };

  // The "Send" button: re-resolve the audience so the confirmed count is never
  // stale relative to edits made after a preview, then open the confirmation
  // dialog. It never dispatches the send itself; the dialog's confirm button
  // does. `sending` guards the in-flight re-resolve so a second Send click
  // there is ignored.
  const handleSend = async () => {
    setSending(true);
    try {
      const current = await previewEmail.mutateAsync({
        subject: subject.trim(),
        body,
        filter: toRecipientFilter(filter),
      });
      setPreview(current);
      if (current.total === 0) {
        toast.error("No recipients with an email address match the filter.");
        return;
      }
      setConfirmOpen(true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send email",
      );
    } finally {
      setSending(false);
    }
  };

  // The confirmation dialog's confirm button: the deliberate action that
  // dispatches the send re-resolved by handleSend, then navigates to the
  // send's detail to watch delivery.
  const handleConfirmSend = async () => {
    try {
      const sent = await sendEmail.mutateAsync({
        template_id: templateId,
        subject: subject.trim(),
        body,
        filter: toRecipientFilter(filter),
      });
      toast.success(
        `Email queued for ${sent.stats.total} recipient${sent.stats.total === 1 ? "" : "s"}`,
      );
      setConfirmOpen(false);
      navigate(`/admin/emails/sends/${sent.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send email",
      );
    }
  };

  // Enqueues the current draft as a real test send to the couple's own inboxes
  // (EMAIL_TEST_RECIPIENTS), rendered from the first guest matching the filter.
  // It goes through the real queue, so on success we open the send's detail to
  // watch delivery, just like a real send.
  const handleSendTest = async () => {
    try {
      const result = await sendTestEmail.mutateAsync({
        template_id: templateId,
        subject: subject.trim(),
        body,
        filter: toRecipientFilter(filter),
      });
      toast.success(
        `Test queued, sending to your inbox${result.queued === 1 ? "" : "es"}.`,
      );
      navigate(`/admin/emails/sends/${result.send_id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send test email",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Compose Email</h1>
          <p className="text-sm text-muted-foreground">
            Write the email, choose who gets it, preview, then send.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/admin/emails">Send history</Link>
        </Button>
      </div>

      <div className="max-w-3xl space-y-4">
        <div className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Template</span>
          <Combobox
            ariaLabel="Template"
            clearable
            onChange={selectTemplate}
            options={templateOptions}
            placeholder="Blank email"
            triggerClassName="w-64 rounded-md border border-input bg-transparent shadow-sm"
            value={templateId}
          />
          <p className="text-xs text-muted-foreground">
            Loading a template copies its subject and body here; edits below
            only affect this send.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="compose-subject">Subject</Label>
          <Input
            id="compose-subject"
            onChange={(e) => {
              setSubject(e.target.value);
              setPreview(undefined);
            }}
            placeholder="Save the date, {{guest_name}}!"
            value={subject}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="compose-body">Body</Label>
          <Textarea
            className="min-h-48"
            id="compose-body"
            onChange={(e) => {
              setBody(e.target.value);
              setPreview(undefined);
            }}
            placeholder={"Hi {{guest_name}},\n\nWe're getting married!"}
            value={body}
          />
          <p className="text-xs text-muted-foreground">{MERGE_FIELDS_HINT}</p>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Recipients</h2>
        <div className="flex flex-wrap gap-4">
          <FilterSelect
            label="Side"
            onChange={(v) => updateFilter("side", v)}
            options={SIDE_OPTIONS}
            value={filter.side}
          />
          <FilterSelect
            label="Relation"
            onChange={(v) => updateFilter("relation", v)}
            options={RELATION_OPTIONS}
            value={filter.relation}
          />
          <FilterSelect
            label="Circle"
            onChange={(v) => updateFilter("circle", v)}
            options={CIRCLE_OPTIONS}
            value={filter.circle}
          />
          <FilterSelect
            label="Invitation"
            onChange={(v) => updateFilter("invitationType", v)}
            options={INVITATION_TYPE_OPTIONS}
            value={filter.invitationType}
          />
          <FilterSelect
            label="Event"
            onChange={(v) => updateFilter("eventId", v)}
            options={eventOptions}
            value={filter.eventId}
          />
          <FilterSelect
            label="RSVP status"
            onChange={(v) => updateFilter("rsvpStatus", v)}
            options={RSVP_STATUS_OPTIONS}
            value={filter.rsvpStatus}
          />
          <FilterSelect
            label="Info status"
            onChange={(v) => updateFilter("infoCollectionStatus", v)}
            options={INFO_STATUS_OPTIONS}
            value={filter.infoCollectionStatus}
          />
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Tags</span>
            <ChipsCombobox
              ariaLabel="Tags"
              onChange={(v) => updateFilter("tags", v)}
              options={tagValues}
              placeholder="Any tag"
              value={filter.tags}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Empty filters match every guest. Guests without an email address are
          always skipped.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={!canCompose || previewEmail.isPending || sending}
          onClick={handlePreview}
          variant="outline"
        >
          {previewEmail.isPending && <Loader2 className="animate-spin" />}
          Preview
        </Button>
        <Button
          disabled={
            !canCompose || sendTestEmail.isPending || sending || hasWarnings
          }
          onClick={handleSendTest}
          variant="outline"
        >
          {sendTestEmail.isPending && <Loader2 className="animate-spin" />}
          Send test
        </Button>
        {/* Pushed to the right, away from "Send test", so the real send is not
            an easy misclick next to it. */}
        <Button
          className="ml-auto"
          disabled={!canCompose || sending || hasWarnings}
          onClick={handleSend}
        >
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
          Send
        </Button>
      </div>

      <Dialog
        onOpenChange={(open) => {
          // Dismissal (Escape, overlay click, the corner X) is ignored while
          // the send is in flight: closing mid-request would read as an abort
          // the request would not honor.
          if (!open && !sendEmail.isPending) setConfirmOpen(false);
        }}
        open={confirmOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this email?</DialogTitle>
            <DialogDescription>
              This will send to {confirmTotal} recipient
              {confirmTotal === 1 ? "" : "s"}.
            </DialogDescription>
          </DialogHeader>

          {(confirmSkippedNote || previewDayNote) && (
            <DialogBody className="space-y-2 text-sm text-muted-foreground">
              {confirmSkippedNote && <p>{confirmSkippedNote}</p>}
              {previewDayNote && <p>{previewDayNote}</p>}
            </DialogBody>
          )}

          <DialogFooter>
            <Button
              onClick={() => setConfirmOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={sendEmail.isPending}
              onClick={handleConfirmSend}
              type="button"
            >
              {sendEmail.isPending && <Loader2 className="animate-spin" />}
              Send to {confirmTotal} recipient{confirmTotal === 1 ? "" : "s"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {preview && (
        <div className="space-y-4 rounded-md border border-ink/10 p-4">
          <div>
            <h2 className="text-lg font-medium">Preview</h2>
            <p className="text-sm text-muted-foreground">
              {preview.total} recipient{preview.total === 1 ? "" : "s"}
              {preview.skipped_no_email > 0 &&
                `, ${preview.skipped_no_email} skipped (no email address)`}
              {preview.skipped_unsubscribed > 0 &&
                `, ${preview.skipped_unsubscribed} skipped (unsubscribed)`}
            </p>
            {previewDayNote && (
              <p className="text-sm text-muted-foreground">{previewDayNote}</p>
            )}
          </div>

          {hasWarnings && (
            <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 p-3">
              <p className="flex items-center gap-2 text-sm font-medium text-destructive">
                <AlertTriangle className="size-4" />
                This email would send a blank merge field. Fix these before
                sending:
              </p>
              <ul className="ml-6 list-disc text-sm text-destructive">
                {preview.warnings.map((warning) => (
                  <li key={warning.field}>{warning.message}</li>
                ))}
              </ul>
            </div>
          )}

          {preview.total > 0 && (
            <>
              <div className="space-y-2 rounded-md bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  As {preview.sample_guest_name} will see it (subject:{" "}
                  <span className="font-medium">{preview.sample_subject}</span>
                  ):
                </p>
                {/* The real HTML email rendered in a sandboxed iframe so the
                    admin sees exactly what goes out. sandbox (no allow-*)
                    blocks scripts and navigation; srcDoc renders the document
                    string the backend built. */}
                <iframe
                  className="h-[44rem] w-full rounded-md border border-ink/10 bg-white"
                  sandbox=""
                  srcDoc={preview.sample_html}
                  title={`Email preview for ${preview.sample_guest_name}`}
                />
              </div>

              <div>
                <h3 className="mb-2 text-sm font-medium">
                  Included recipients ({preview.total})
                </h3>
                {/* Cap the height so a large audience stays usable; the list
                    scrolls within the bordered container. */}
                <div className="max-h-80 overflow-y-auto rounded-md border border-ink/10">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Guest</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Party</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.recipients.map((recipient) => (
                        <TableRow key={recipient.guest_id}>
                          <TableCell>{recipient.guest_name}</TableCell>
                          <TableCell>{recipient.email_address}</TableCell>
                          <TableCell>{recipient.party_name}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}

          {preview.skipped.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                Skipped (no email address) ({preview.skipped.length})
              </h3>
              <div className="max-h-48 overflow-y-auto rounded-md border border-ink/10">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Guest</TableHead>
                      <TableHead>Party</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.skipped.map((guest) => (
                      <TableRow key={guest.guest_id}>
                        <TableCell>{guest.guest_name}</TableCell>
                        <TableCell>{guest.party_name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {preview.unsubscribed.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                Unsubscribed ({preview.unsubscribed.length})
              </h3>
              <div className="max-h-48 overflow-y-auto rounded-md border border-ink/10">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Guest</TableHead>
                      <TableHead>Party</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.unsubscribed.map((guest) => (
                      <TableRow key={guest.guest_id}>
                        <TableCell>{guest.guest_name}</TableCell>
                        <TableCell>{guest.party_name}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
