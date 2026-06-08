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
import type { Guest } from "@/types/generated/models";
import type { CreateGuestPayload } from "@/types/generated/parties";

interface GuestFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present in edit mode; absent for create. */
  guest?: Guest;
  /** Receives the full guest payload (create and update share these fields). */
  onSubmit: (payload: CreateGuestPayload) => Promise<void>;
  isPending: boolean;
}

interface FormState {
  fullName: string;
  email: string;
  phone: string;
  tags: string;
  dietaryRestrictions: string;
  tableNumber: string;
  seatNumber: string;
  isPrimary: boolean;
  isChild: boolean;
  isDrinking: boolean;
  isPlaceholder: boolean;
}

const EMPTY_FORM: FormState = {
  fullName: "",
  email: "",
  phone: "",
  tags: "",
  dietaryRestrictions: "",
  tableNumber: "",
  seatNumber: "",
  isPrimary: false,
  isChild: false,
  isDrinking: false,
  isPlaceholder: false,
};

function formFromGuest(guest: Guest): FormState {
  return {
    fullName: guest.full_name,
    email: guest.email ?? "",
    phone: guest.phone ?? "",
    tags: guest.tags.join(", "),
    dietaryRestrictions: guest.dietary_restrictions ?? "",
    tableNumber: guest.table_number?.toString() ?? "",
    seatNumber: guest.seat_number?.toString() ?? "",
    isPrimary: guest.is_primary,
    isChild: guest.is_child,
    isDrinking: guest.is_drinking,
    isPlaceholder: guest.is_placeholder,
  };
}

function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

// Parses a numeric text field to an optional int; a blank or non-numeric value
// becomes undefined so the binder treats it as "unset" rather than 0.
function optionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Splits the comma-separated tags field into trimmed, non-empty tags. tags is
// open-ended, so it is just a list of strings.
function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/**
 * Create/edit dialog for a guest. Same local-useState pattern as the party
 * dialog. Covers every editable guest field including the flags, is_primary, and
 * table/seat numbers. Setting is_primary here is enforced single-primary by the
 * API transactionally; after the mutation the refetched party reflects the swap.
 */
export function GuestFormDialog({
  open,
  onOpenChange,
  guest,
  onSubmit,
  isPending,
}: GuestFormDialogProps) {
  const isEditMode = Boolean(guest);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Re-seed the form on each closed->open transition (adjusting state during
  // render, the React-endorsed alternative to an effect) so a prior session's
  // edits never leak into the next open.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(guest ? formFromGuest(guest) : EMPTY_FORM);
    }
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async () => {
    const payload: CreateGuestPayload = {
      full_name: form.fullName.trim(),
      email: optional(form.email),
      phone: optional(form.phone),
      tags: parseTags(form.tags),
      dietary_restrictions: optional(form.dietaryRestrictions),
      table_number: optionalInt(form.tableNumber),
      seat_number: optionalInt(form.seatNumber),
      is_primary: form.isPrimary,
      is_child: form.isChild,
      is_drinking: form.isDrinking,
      is_placeholder: form.isPlaceholder,
    };
    await onSubmit(payload);
  };

  const canSave = form.fullName.trim().length > 0;

  const flags: { key: keyof FormState; label: string }[] = [
    { key: "isPrimary", label: "Primary guest" },
    { key: "isChild", label: "Child" },
    { key: "isDrinking", label: "Drinking" },
    { key: "isPlaceholder", label: "Placeholder" },
  ];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditMode ? "Edit guest" : "Add guest"}</DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update this guest's details."
              : "Add a guest to this party."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="guest-name">Full name</Label>
            <Input
              id="guest-name"
              onChange={(e) => update("fullName", e.target.value)}
              placeholder="Jane Smith"
              value={form.fullName}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="guest-email">Email</Label>
              <Input
                id="guest-email"
                onChange={(e) => update("email", e.target.value)}
                type="email"
                value={form.email}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guest-phone">Phone</Label>
              <Input
                id="guest-phone"
                onChange={(e) => update("phone", e.target.value)}
                value={form.phone}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guest-tags">Tags</Label>
            <Input
              id="guest-tags"
              onChange={(e) => update("tags", e.target.value)}
              placeholder="Comma-separated, e.g. Bridal Party, College"
              value={form.tags}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guest-dietary">Dietary restrictions</Label>
            <Textarea
              id="guest-dietary"
              onChange={(e) => update("dietaryRestrictions", e.target.value)}
              rows={2}
              value={form.dietaryRestrictions}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="guest-table">Table number</Label>
              <Input
                id="guest-table"
                min={1}
                onChange={(e) => update("tableNumber", e.target.value)}
                type="number"
                value={form.tableNumber}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="guest-seat">Seat number</Label>
              <Input
                id="guest-seat"
                min={1}
                onChange={(e) => update("seatNumber", e.target.value)}
                type="number"
                value={form.seatNumber}
              />
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Flags</legend>
            <div className="grid grid-cols-2 gap-2">
              {flags.map((flag) => (
                <label
                  className="flex items-center gap-2 text-sm"
                  key={flag.key}
                >
                  <Checkbox
                    checked={form[flag.key] as boolean}
                    onCheckedChange={(checked) =>
                      update(flag.key, (checked === true) as never)
                    }
                  />
                  {flag.label}
                </label>
              ))}
            </div>
          </fieldset>
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
            {isEditMode ? "Save" : "Add guest"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
