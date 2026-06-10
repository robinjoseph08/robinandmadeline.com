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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  InvitationPhysical,
  RelationFamily,
  SideRobin,
  type Circle,
  type InvitationType,
  type Relation,
  type Side,
} from "@/types/generated/models";
import type {
  CreatePartyPayload,
  PartyResponse,
  UpdatePartyPayload,
} from "@/types/generated/parties";

import {
  CIRCLE_OPTIONS,
  INVITATION_TYPE_OPTIONS,
  RELATION_OPTIONS,
  SIDE_OPTIONS,
} from "./options";

// The dialog serves both create (POST) and edit (PUT), and it always builds the
// full field set, so the payload it emits satisfies both shapes. The
// intersection keeps a caller honest either way: an edit handler typed against
// UpdatePartyPayload and a create handler typed against CreatePartyPayload are
// both assignable, and this stops compiling if the two shapes ever drift.
export type PartyFormPayload = CreatePartyPayload & UpdatePartyPayload;

interface PartyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present in edit mode; absent for create. */
  party?: PartyResponse;
  /** Receives the full party payload (create and update share these fields). */
  onSubmit: (payload: PartyFormPayload) => Promise<void>;
  isPending: boolean;
}

interface FormState {
  name: string;
  side: Side;
  relation: Relation;
  circle: Circle[];
  invitationType: InvitationType;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  country: string;
  rsvpCode: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  side: SideRobin,
  relation: RelationFamily,
  circle: [],
  invitationType: InvitationPhysical,
  addressLine1: "",
  addressLine2: "",
  city: "",
  stateOrProvince: "",
  postalCode: "",
  country: "",
  rsvpCode: "",
};

function formFromParty(party: PartyResponse): FormState {
  return {
    name: party.name,
    side: party.side,
    relation: party.relation,
    circle: party.circle,
    invitationType: party.invitation_type,
    addressLine1: party.address_line_1 ?? "",
    addressLine2: party.address_line_2 ?? "",
    city: party.city ?? "",
    stateOrProvince: party.state_or_province ?? "",
    postalCode: party.postal_code ?? "",
    country: party.country ?? "",
    rsvpCode: party.rsvp_code ?? "",
  };
}

// Maps a trimmed text field to its payload value: an empty optional field is sent
// as undefined so it persists as SQL NULL rather than a blank string.
function optional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Create/edit dialog for a party. Mirrors the shisho dialog pattern: plain local
 * useState (no react-hook-form), re-seeded each time the dialog opens. Light
 * client-side UX only (the name is required to submit); the binder remains the
 * authoritative validator and its messages surface via the parent's toast.
 */
export function PartyFormDialog({
  open,
  onOpenChange,
  party,
  onSubmit,
  isPending,
}: PartyFormDialogProps) {
  const isEditMode = Boolean(party);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  // Re-seed the form on each closed->open transition so a previous session's
  // edits never leak into the next open. This adjusts state during render (the
  // React-endorsed alternative to an effect), tracking the prior open state.
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(party ? formFromParty(party) : EMPTY_FORM);
    }
  }

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const toggleCircle = (value: Circle, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      circle: checked
        ? [...prev.circle, value]
        : prev.circle.filter((c) => c !== value),
    }));

  const handleSubmit = async () => {
    const payload: PartyFormPayload = {
      name: form.name.trim(),
      side: form.side,
      relation: form.relation,
      circle: form.circle,
      invitation_type: form.invitationType,
      address_line_1: optional(form.addressLine1),
      address_line_2: optional(form.addressLine2),
      city: optional(form.city),
      state_or_province: optional(form.stateOrProvince),
      postal_code: optional(form.postalCode),
      country: optional(form.country),
      rsvp_code: optional(form.rsvpCode),
    };
    await onSubmit(payload);
  };

  const canSave = form.name.trim().length > 0;

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? "Edit party" : "Create party"}
          </DialogTitle>
          <DialogDescription>
            {isEditMode
              ? "Update this party's details. The info token and collection status are unaffected."
              : "Add a new party. The info token and RSVP code are generated automatically."}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="party-name">Name</Label>
            <Input
              id="party-name"
              onChange={(e) => update("name", e.target.value)}
              placeholder="The Smith Family"
              value={form.name}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="party-side">Side</Label>
              <Select
                onValueChange={(v) => update("side", v as Side)}
                value={form.side}
              >
                <SelectTrigger id="party-side">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SIDE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="party-relation">Relation</Label>
              <Select
                onValueChange={(v) => update("relation", v as Relation)}
                value={form.relation}
              >
                <SelectTrigger id="party-relation">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATION_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="party-invitation-type">Invitation type</Label>
            <Select
              onValueChange={(v) =>
                update("invitationType", v as InvitationType)
              }
              value={form.invitationType}
            >
              <SelectTrigger id="party-invitation-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITATION_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Circle</legend>
            <div className="grid grid-cols-2 gap-2">
              {CIRCLE_OPTIONS.map((o) => (
                <label
                  className="flex items-center gap-2 text-sm"
                  key={o.value}
                >
                  <Checkbox
                    checked={form.circle.includes(o.value)}
                    onCheckedChange={(checked) =>
                      toggleCircle(o.value, checked === true)
                    }
                  />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className="space-y-3 rounded-md border border-ink/10 p-3">
            <legend className="px-1 text-sm font-medium">
              Mailing address
            </legend>
            <p className="text-xs text-muted-foreground">
              Required for physical invitations to be marked complete.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="party-address-1">Address line 1</Label>
              <Input
                id="party-address-1"
                onChange={(e) => update("addressLine1", e.target.value)}
                value={form.addressLine1}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="party-address-2">Address line 2</Label>
              <Input
                id="party-address-2"
                onChange={(e) => update("addressLine2", e.target.value)}
                value={form.addressLine2}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="party-city">City</Label>
                <Input
                  id="party-city"
                  onChange={(e) => update("city", e.target.value)}
                  value={form.city}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="party-state">State / province</Label>
                <Input
                  id="party-state"
                  onChange={(e) => update("stateOrProvince", e.target.value)}
                  value={form.stateOrProvince}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="party-postal">Postal code</Label>
                <Input
                  id="party-postal"
                  onChange={(e) => update("postalCode", e.target.value)}
                  value={form.postalCode}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="party-country">Country</Label>
                <Input
                  id="party-country"
                  onChange={(e) => update("country", e.target.value)}
                  value={form.country}
                />
              </div>
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <Label htmlFor="party-rsvp">RSVP code</Label>
            <Input
              id="party-rsvp"
              onChange={(e) => update("rsvpCode", e.target.value)}
              placeholder={
                isEditMode
                  ? "Leave blank to clear the code"
                  : "Leave blank to auto-generate"
              }
              value={form.rsvpCode}
            />
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
