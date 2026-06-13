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
 * recipient count and asks for confirmation with it, so the number confirmed
 * is never stale; the actual delivery happens in the background and the page
 * navigates to the send's detail to watch it progress.
 */
export default function AdminEmailCompose() {
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
  // True for the whole send flow (the re-resolve, the confirm, the send), not
  // just the send mutation: the confirm count round-trip leaves a window where
  // sendEmail.isPending is still false, and a double click there would
  // dispatch the entire bulk send twice.
  const [sending, setSending] = useState(false);

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

  const handleSend = async () => {
    setSending(true);
    try {
      // Re-resolve the audience at send time so the confirmed count can never
      // be stale relative to edits made after a preview.
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
      const skippedNote =
        current.skipped_no_email > 0
          ? ` (${current.skipped_no_email} matching guest${current.skipped_no_email === 1 ? "" : "s"} without an email will be skipped)`
          : "";
      const dayNote = multiDaySendNote(current);
      if (
        !window.confirm(
          `Send this email to ${current.total} recipient${current.total === 1 ? "" : "s"}?${skippedNote}${dayNote ? ` ${dayNote}` : ""}`,
        )
      )
        return;

      const sent = await sendEmail.mutateAsync({
        template_id: templateId,
        subject: subject.trim(),
        body,
        filter: toRecipientFilter(filter),
      });
      toast.success(
        `Email queued for ${sent.stats.total} recipient${sent.stats.total === 1 ? "" : "s"}`,
      );
      navigate(`/admin/emails/sends/${sent.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send email",
      );
    } finally {
      setSending(false);
    }
  };

  // Sends the current draft to the couple's own inboxes (EMAIL_TEST_RECIPIENTS),
  // rendered against sample data so it always looks complete; no merge-field
  // warning gates it (it is sample data by design).
  const handleSendTest = async () => {
    try {
      const result = await sendTestEmail.mutateAsync({
        template_id: templateId,
        subject: subject.trim(),
        body,
        filter: toRecipientFilter(filter),
      });
      toast.success(
        `Test email sent to ${result.sent_to} recipient${result.sent_to === 1 ? "" : "s"}`,
      );
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
          disabled={!canCompose || sendTestEmail.isPending || sending}
          onClick={handleSendTest}
          variant="outline"
        >
          {sendTestEmail.isPending && <Loader2 className="animate-spin" />}
          Send test
        </Button>
        <Button
          disabled={!canCompose || sending || hasWarnings}
          onClick={handleSend}
        >
          {sending ? <Loader2 className="animate-spin" /> : <Send />}
          Send
        </Button>
      </div>

      {preview && (
        <div className="space-y-4 rounded-md border border-ink/10 p-4">
          <div>
            <h2 className="text-lg font-medium">Preview</h2>
            <p className="text-sm text-muted-foreground">
              {preview.total} recipient{preview.total === 1 ? "" : "s"}
              {preview.skipped_no_email > 0 &&
                `, ${preview.skipped_no_email} matching guest${preview.skipped_no_email === 1 ? "" : "s"} skipped (no email address)`}
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
        </div>
      )}
    </div>
  );
}
