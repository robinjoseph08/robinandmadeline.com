import { Loader2 } from "lucide-react";
import { useState } from "react";

import { ChipsInput } from "@/components/library/ChipsInput";
import { PhoneField } from "@/components/library/PhoneField";
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
import { formatPhone } from "@/libraries/phone";
import type { Guest } from "@/types/generated/models";
import type {
  CreateGuestPayload,
  UpdateGuestPayload,
} from "@/types/generated/parties";

// The dialog serves both create (POST) and edit (PUT), and it always builds the
// full field set, so the payload it emits satisfies both shapes. The
// intersection keeps a caller honest either way: an edit handler typed against
// UpdateGuestPayload and a create handler typed against CreateGuestPayload are
// both assignable, and this stops compiling if the two shapes ever drift.
export type GuestFormPayload = CreateGuestPayload & UpdateGuestPayload;

interface GuestFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present in edit mode; absent for create. */
  guest?: Guest;
  /** Receives the full guest payload (create and update share these fields). */
  onSubmit: (payload: GuestFormPayload) => Promise<void>;
  isPending: boolean;
}

interface FormState {
  fullName: string;
  email: string;
  phone: string;
  tags: string[];
  placeholderText: string;
  dietaryRestrictions: string;
  tableNumber: string;
  seatNumber: string;
  isPrimary: boolean;
  isChild: boolean;
  isDrinking: boolean;
  subscribed: boolean;
}

const EMPTY_FORM: FormState = {
  fullName: "",
  email: "",
  phone: "",
  tags: [],
  placeholderText: "",
  dietaryRestrictions: "",
  tableNumber: "",
  seatNumber: "",
  isPrimary: false,
  isChild: false,
  isDrinking: false,
  // A new guest defaults to subscribed (ADR 0009); the admin can opt them out.
  subscribed: true,
};

function formFromGuest(guest: Guest): FormState {
  return {
    fullName: guest.full_name,
    email: guest.email ?? "",
    phone: formatPhone(guest.phone ?? ""),
    tags: guest.tags,
    placeholderText: guest.placeholder_text ?? "",
    dietaryRestrictions: guest.dietary_restrictions ?? "",
    tableNumber: guest.table_number?.toString() ?? "",
    seatNumber: guest.seat_number?.toString() ?? "",
    isPrimary: guest.is_primary,
    isChild: guest.is_child,
    isDrinking: guest.is_drinking,
    subscribed: guest.subscribed,
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
    const payload: GuestFormPayload = {
      full_name: form.fullName.trim(),
      email: optional(form.email),
      phone: optional(form.phone),
      tags: form.tags,
      // A blanked field drops the key, so the PUT stores NULL and the guest
      // becomes (or stays) a regular one.
      placeholder_text: optional(form.placeholderText),
      dietary_restrictions: optional(form.dietaryRestrictions),
      table_number: optionalInt(form.tableNumber),
      seat_number: optionalInt(form.seatNumber),
      is_primary: form.isPrimary,
      is_child: form.isChild,
      is_drinking: form.isDrinking,
      subscribed: form.subscribed,
    };
    await onSubmit(payload);
  };

  const canSave = form.fullName.trim().length > 0;

  // Narrowing the keys to the boolean fields lets the generic update() accept
  // `checked` directly: FormState[FlagKey] is boolean, so no cast is needed.
  type FlagKey = "isPrimary" | "isChild" | "isDrinking" | "subscribed";
  const flags: { key: FlagKey; label: string }[] = [
    { key: "isPrimary", label: "Primary guest" },
    { key: "isChild", label: "Child" },
    { key: "isDrinking", label: "Drinking" },
    { key: "subscribed", label: "Subscribed" },
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
              <PhoneField
                id="guest-phone"
                onChange={(value) => update("phone", value)}
                placeholder="9725551234"
                value={form.phone}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guest-tags">Tags</Label>
            <ChipsInput
              id="guest-tags"
              onChange={(tags) => update("tags", tags)}
              placeholder="Type a tag and press Enter, e.g. Sibling"
              value={form.tags}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="guest-placeholder-text">Placeholder text</Label>
            <Input
              id="guest-placeholder-text"
              onChange={(e) => update("placeholderText", e.target.value)}
              placeholder='e.g. "Guest of Jane Smith" (blank for a regular guest)'
              value={form.placeholderText}
            />
            <p className="text-xs text-muted-foreground">
              Set for an unnamed plus-one slot. The descriptor is permanent:
              naming the guest never erases it. Clear it to make this a regular
              guest.
            </p>
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
              {flags.map((flag) => {
                // Lock the current primary's flag like the grid's primary cell
                // does: a party must keep one primary, so you promote another
                // guest to move it (the API refuses unchecking it here too).
                const lockPrimary =
                  flag.key === "isPrimary" && guest?.is_primary === true;
                return (
                  <label
                    className="flex items-center gap-2 text-sm"
                    key={flag.key}
                    title={
                      lockPrimary
                        ? "A party must keep a primary guest. Promote another guest to move it."
                        : undefined
                    }
                  >
                    <Checkbox
                      checked={form[flag.key]}
                      disabled={lockPrimary}
                      onCheckedChange={(checked) =>
                        update(flag.key, checked === true)
                      }
                    />
                    {flag.label}
                  </label>
                );
              })}
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
