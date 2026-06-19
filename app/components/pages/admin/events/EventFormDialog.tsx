import { Loader2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  CreateEventPayload,
  EventResponse,
  UpdateEventPayload,
} from "@/types/generated/events";

// The dialog serves both create (POST) and edit (PUT), and it always builds the
// full field set, so the payload it emits satisfies both shapes (see
// PartyFormPayload for the pattern).
export type EventFormPayload = CreateEventPayload & UpdateEventPayload;

interface EventFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present in edit mode; absent for create. */
  event?: EventResponse;
  /** Receives the full event payload (create and update share these fields). */
  onSubmit: (payload: EventFormPayload) => Promise<void>;
  isPending: boolean;
}

interface FormState {
  name: string;
  description: string;
  location: string;
  locationUrl: string;
  date: string;
  startTime: string;
  endTime: string;
  isPublic: boolean;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  location: "",
  locationUrl: "",
  date: "",
  startTime: "",
  endTime: "",
  isPublic: false,
};

function formFromEvent(event: EventResponse): FormState {
  return {
    name: event.name,
    description: event.description ?? "",
    location: event.location ?? "",
    locationUrl: event.location_url ?? "",
    date: event.date,
    startTime: event.start_time ?? "",
    endTime: event.end_time ?? "",
    isPublic: event.is_public,
  };
}

// Maps a trimmed text field to its payload value: an empty optional field is
// sent as undefined so it persists as SQL NULL rather than a blank string.
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Create/edit dialog for an event. Plain local useState re-seeded each time
 * the dialog opens (the PartyFormDialog pattern). Light client-side UX only
 * (name and date are required to submit); the binder remains the authoritative
 * validator and its messages surface via the parent's toast. The visibility
 * checkbox spells out the invitation consequences (ADR 0002): a public event
 * automatically invites every guest, including future ones.
 */
export function EventFormDialog({
  open,
  onOpenChange,
  event,
  onSubmit,
  isPending,
}: EventFormDialogProps) {
  const isEditMode = Boolean(event);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Re-seed the form on each closed->open transition so a previous session's
  // edits never leak into the next open (state-during-render, not an effect).
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(event ? formFromEvent(event) : EMPTY_FORM);
    }
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    const payload: EventFormPayload = {
      name: form.name.trim(),
      description: optional(form.description),
      location: optional(form.location),
      location_url: optional(form.locationUrl),
      date: form.date,
      start_time: optional(form.startTime),
      end_time: optional(form.endTime),
      is_public: form.isPublic,
    };
    await onSubmit(payload);
  };

  const canSave = form.name.trim().length > 0 && form.date !== "";

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? "Edit event" : "Create event"}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update this event's details. Existing RSVPs are kept."
              : "Add a wedding event to the schedule."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="event-name">Name</Label>
            <Input
              id="event-name"
              onChange={(e) => update("name", e.target.value)}
              placeholder="Reception"
              value={form.name}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-description">Description</Label>
            <Textarea
              id="event-description"
              onChange={(e) => update("description", e.target.value)}
              placeholder="Dinner, toasts, and dancing"
              value={form.description}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-location">Location</Label>
            <Input
              id="event-location"
              onChange={(e) => update("location", e.target.value)}
              placeholder="Garden Pavilion"
              value={form.location}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="event-location-url">Location link</Label>
            <Input
              id="event-location-url"
              onChange={(e) => update("locationUrl", e.target.value)}
              placeholder="https://maps.app.goo.gl/..."
              type="url"
              value={form.locationUrl}
            />
            <p className="text-xs text-muted-foreground">
              Optional. A map or directions link guests can open from the
              schedule. Paste the full URL (starting with https://); requires a
              location.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="event-date">Date</Label>
              <Input
                id="event-date"
                onChange={(e) => update("date", e.target.value)}
                type="date"
                value={form.date}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-start">Start time</Label>
              <Input
                id="event-start"
                onChange={(e) => update("startTime", e.target.value)}
                type="time"
                value={form.startTime}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-end">End time</Label>
              <Input
                id="event-end"
                onChange={(e) => update("endTime", e.target.value)}
                type="time"
                value={form.endTime}
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={form.isPublic}
              className="mt-0.5"
              onCheckedChange={(checked) =>
                update("isPublic", checked === true)
              }
            />
            <span>
              <span className="font-medium">Public event</span>
              <span className="block text-xs text-muted-foreground">
                Public events appear on the schedule for everyone, and every
                guest (including ones added later) is automatically invited with
                a pending RSVP. Private events invite only the parties you
                choose.
              </span>
            </span>
          </label>
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
