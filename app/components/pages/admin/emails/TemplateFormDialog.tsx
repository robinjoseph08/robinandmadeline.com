import { Loader2 } from "lucide-react";
import { useState } from "react";

import { MERGE_FIELDS_HINT } from "@/components/pages/admin/emails/merge-fields";
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
import { Textarea } from "@/components/ui/textarea";
import type {
  CreateTemplatePayload,
  TemplateResponse,
  UpdateTemplatePayload,
} from "@/types/generated/emails";

// The dialog serves both create (POST) and edit (PUT), and it always builds
// the full field set, so the payload it emits satisfies both shapes (the
// EventFormDialog pattern).
export type TemplateFormPayload = CreateTemplatePayload & UpdateTemplatePayload;

interface TemplateFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present in edit mode; absent for create. */
  template?: TemplateResponse;
  onSubmit: (payload: TemplateFormPayload) => Promise<void>;
  isPending: boolean;
}

interface FormState {
  name: string;
  subject: string;
  body: string;
}

const EMPTY_FORM: FormState = { name: "", subject: "", body: "" };

/**
 * Create/edit dialog for an email template. Plain local useState re-seeded on
 * each open (the EventFormDialog pattern). Subject and body accept merge field
 * placeholders, resolved per recipient at send time, never on the template.
 */
export function TemplateFormDialog({
  open,
  onOpenChange,
  template,
  onSubmit,
  isPending,
}: TemplateFormDialogProps) {
  const isEditMode = Boolean(template);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Re-seed the form on each closed->open transition so a previous session's
  // edits never leak into the next open (state-during-render, not an effect).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(
        template
          ? {
              name: template.name,
              subject: template.subject,
              body: template.body,
            }
          : EMPTY_FORM,
      );
    }
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const canSave =
    form.name.trim().length > 0 &&
    form.subject.trim().length > 0 &&
    form.body.length > 0;

  const handleSubmit = async () => {
    await onSubmit({
      name: form.name.trim(),
      subject: form.subject.trim(),
      body: form.body,
    });
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? "Edit template" : "Create template"}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update this template. Past sends keep the copy they were sent with."
              : "A reusable email you can send to a filtered set of guests."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="template-name">Name</Label>
            <Input
              id="template-name"
              onChange={(e) => update("name", e.target.value)}
              placeholder="Save the date"
              value={form.name}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="template-subject">Subject</Label>
            <Input
              id="template-subject"
              onChange={(e) => update("subject", e.target.value)}
              placeholder="Save the date, {{guest_name}}!"
              value={form.subject}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="template-body">Body</Label>
            <Textarea
              className="min-h-40"
              id="template-body"
              onChange={(e) => update("body", e.target.value)}
              placeholder={"Hi {{guest_name}},\n\nWe're getting married!"}
              value={form.body}
            />
            <p className="text-xs text-muted-foreground">{MERGE_FIELDS_HINT}</p>
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="outline"
          >
            Cancel
          </Button>
          <Button
            disabled={isPending || !canSave}
            onClick={handleSubmit}
            type="button"
          >
            {isPending && <Loader2 className="animate-spin" />}
            {isEditMode ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
