import { Loader2, Send } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

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
} from "@/hooks/queries/emails";
import { useEvents } from "@/hooks/queries/events";
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
  tags: string;
  eventId?: string;
  rsvpStatus?: EventRSVPStatus;
  invitationType?: InvitationType;
  infoCollectionStatus?: InfoCollectionStatus;
}

const EMPTY_FILTER: FilterState = { tags: "" };

/** Builds the wire filter, dropping unset criteria. */
function toRecipientFilter(filter: FilterState): RecipientFilter {
  const tag = filter.tags.trim();
  return {
    side: filter.side,
    relation: filter.relation,
    circle: filter.circle,
    tags: tag === "" ? undefined : tag,
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
  const previewEmail = usePreviewEmail();
  const sendEmail = useSendEmail();

  const [templateId, setTemplateId] = useState<string | undefined>(undefined);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [preview, setPreview] = useState<PreviewEmailResponse | undefined>(
    undefined,
  );

  const templates = templatesQuery.data?.items ?? [];
  const events = eventsQuery.data?.items ?? [];

  const templateOptions = templates.map((t) => ({
    value: t.id,
    label: t.name,
  }));
  const eventOptions = events.map((e) => ({ value: e.id, label: e.name }));

  const canCompose = subject.trim().length > 0 && body.length > 0;

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
      if (
        !window.confirm(
          `Send this email to ${current.total} recipient${current.total === 1 ? "" : "s"}?${skippedNote}`,
        )
      )
        return;

      const sent = await sendEmail.mutateAsync({
        template_id: templateId,
        subject: subject.trim(),
        body,
        filter: toRecipientFilter(filter),
      });
      toast.success(`Email queued for ${sent.stats.total} recipients`);
      navigate(`/admin/emails/sends/${sent.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to send email",
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
            <Label className="font-medium" htmlFor="compose-tag">
              Tag
            </Label>
            <Input
              className="w-40"
              id="compose-tag"
              onChange={(e) => updateFilter("tags", e.target.value)}
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

      <div className="flex gap-2">
        <Button
          disabled={!canCompose || previewEmail.isPending}
          onClick={handlePreview}
          variant="outline"
        >
          {previewEmail.isPending && <Loader2 className="animate-spin" />}
          Preview
        </Button>
        <Button
          disabled={!canCompose || sendEmail.isPending}
          onClick={handleSend}
        >
          {sendEmail.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Send />
          )}
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
          </div>

          {preview.total > 0 && (
            <>
              <div className="space-y-1 rounded-md bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  As {preview.sample_guest_name} will see it:
                </p>
                <p className="font-medium">{preview.sample_subject}</p>
                <p className="whitespace-pre-wrap text-sm">
                  {preview.sample_body}
                </p>
              </div>

              <div className="rounded-md border border-ink/10">
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
            </>
          )}
        </div>
      )}
    </div>
  );
}
