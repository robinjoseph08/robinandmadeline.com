import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useCreateGuest,
  useDeleteGuest,
  usePatchGuest,
} from "@/hooks/queries/guests";
import type { Guest } from "@/types/generated/models";
import type {
  CreateGuestPayload,
  PatchGuestPayload,
} from "@/types/generated/parties";

import {
  GridBoolCell,
  GridChipsCell,
  GridReadOnlyCell,
  GridTextCell,
} from "./cells";
import { InfoHint, TooltipIconButton } from "./grid-buttons";

// Tooltip copy for the guest flag columns, surfaced via an info icon in each
// header so the meaning of each flag is discoverable.
const FLAG_HINTS = {
  primary:
    "The party's main contact (one per party). Their email is required to mark the party's info complete.",
  child: "Guest is a child, for meal and seating planning.",
  drinking: "Guest drinks alcohol, for bar and beverage counts.",
  placeholder:
    "A stand-in for an unnamed guest or an unconfirmed plus-one (e.g. a +1 whose name you do not have yet).",
};

interface GuestsGridProps<TGuest extends Guest> {
  guests: TGuest[];
  /** Party id used to scope each guest write's cache invalidation. */
  partyIdFor: (guest: TGuest) => string;
  /** Opens the full-edit dialog (dietary restrictions, table/seat numbers). */
  onEditGuest: (guest: TGuest) => void;
  /** Renders the trailing party cell (the flat list links each guest's party). */
  renderParty?: (guest: TGuest) => ReactNode;
  /** When set, the "Add guest" button creates a guest in this party. */
  addPartyId?: string;
}

interface GuestDraft {
  fullName: string;
  email: string;
  phone: string;
  tags: string[];
  isPrimary: boolean;
  isChild: boolean;
  isDrinking: boolean;
  isPlaceholder: boolean;
}

const EMPTY_DRAFT: GuestDraft = {
  fullName: "",
  email: "",
  phone: "",
  tags: [],
  isPrimary: false,
  isChild: false,
  isDrinking: false,
  isPlaceholder: false,
};

// renderParty and addPartyId are mutually exclusive in practice: the flat guest
// list passes renderParty (and no add row, since a guest needs a party), while a
// party's detail page passes addPartyId (and no party column, the party is
// implicit). Keeping them apart matters because the add row has no party cell, so
// it would be one column short if a party column were also rendered.

/**
 * The guest list as an editable spreadsheet, shared by the flat guest list and a
 * party's detail page. Each cell saves itself via PATCH on blur/Enter; the four
 * flags are inline checkboxes (with info tooltips in their headers), tags is a
 * searchable, creatable, colored-chip multi-select, and promoting a guest to
 * primary demotes the party's previous primary (enforced by the API). The flat
 * list passes renderParty to link each guest back to its party; the detail page
 * passes addPartyId to enable the "Add guest" row. Dietary restrictions and
 * table/seat numbers stay behind the edit dialog (onEditGuest).
 */
export function GuestsGrid<TGuest extends Guest>({
  guests,
  partyIdFor,
  onEditGuest,
  renderParty,
  addPartyId,
}: GuestsGridProps<TGuest>) {
  const patchGuest = usePatchGuest();
  const createGuest = useCreateGuest();
  const deleteGuest = useDeleteGuest();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<GuestDraft>(EMPTY_DRAFT);

  // Existing tags across the loaded guests, to suggest in every tag cell.
  const tagSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const all: string[] = [];
    for (const guest of guests) {
      for (const tag of guest.tags) {
        const key = tag.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          all.push(tag);
        }
      }
    }
    return all.sort((a, b) => a.localeCompare(b));
  }, [guests]);

  // Save one field. Resolves to void on success; toasts and re-throws on failure
  // so the cell rolls back to the value the server still holds.
  const patchField = (
    guestId: string,
    partyId: string,
    payload: PatchGuestPayload,
  ): Promise<void> =>
    patchGuest.mutateAsync({ guestId, partyId, payload }).then(
      () => undefined,
      (error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Failed to save");
        throw error;
      },
    );

  const setDraftField = <K extends keyof GuestDraft>(
    key: K,
    value: GuestDraft[K],
  ) => setDraft((prev) => ({ ...prev, [key]: value }));

  const canCreate = draft.fullName.trim() !== "";

  const handleCreate = async () => {
    if (!canCreate || !addPartyId) return;
    const payload: CreateGuestPayload = {
      full_name: draft.fullName.trim(),
      email: draft.email.trim() || undefined,
      phone: draft.phone.trim() || undefined,
      tags: draft.tags,
      is_primary: draft.isPrimary,
      is_child: draft.isChild,
      is_drinking: draft.isDrinking,
      is_placeholder: draft.isPlaceholder,
    };
    try {
      await createGuest.mutateAsync({ partyId: addPartyId, payload });
      toast.success(`Added ${payload.full_name}`);
      setDraft(EMPTY_DRAFT); // keep the add row open for rapid entry
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add guest",
      );
    }
  };

  const cancelAdd = () => {
    setAdding(false);
    setDraft(EMPTY_DRAFT);
  };

  const handleDelete = async (guest: TGuest) => {
    if (!window.confirm(`Delete ${guest.full_name}?`)) return;
    try {
      await deleteGuest.mutateAsync({
        guestId: guest.id,
        partyId: partyIdFor(guest),
      });
      toast.success("Guest deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete guest",
      );
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-24 text-center">
            <HeaderWithHint hint={FLAG_HINTS.primary} label="Primary" />
          </TableHead>
          <TableHead className="min-w-40">Name</TableHead>
          <TableHead className="min-w-48">Email</TableHead>
          <TableHead className="w-36">Phone</TableHead>
          <TableHead className="min-w-40">Tags</TableHead>
          <TableHead className="w-20 text-center">
            <HeaderWithHint hint={FLAG_HINTS.child} label="Child" />
          </TableHead>
          <TableHead className="w-24 text-center">
            <HeaderWithHint hint={FLAG_HINTS.drinking} label="Drinking" />
          </TableHead>
          <TableHead className="w-28 text-center">
            <HeaderWithHint hint={FLAG_HINTS.placeholder} label="Placeholder" />
          </TableHead>
          {renderParty ? <TableHead className="w-40">Party</TableHead> : null}
          <TableHead className="w-20 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {guests.map((guest) => {
          const partyId = partyIdFor(guest);
          return (
            <TableRow key={guest.id}>
              <GridBoolCell
                ariaLabel="Primary"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { is_primary: value })
                }
                value={guest.is_primary}
              />
              <GridTextCell
                ariaLabel="Name"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { full_name: value })
                }
                value={guest.full_name}
              />
              <GridTextCell
                ariaLabel="Email"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { email: value })
                }
                placeholder="None"
                type="email"
                value={guest.email ?? ""}
              />
              <GridTextCell
                ariaLabel="Phone"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { phone: value })
                }
                placeholder="None"
                value={guest.phone ?? ""}
              />
              <GridChipsCell
                ariaLabel="Tags"
                creatable
                onCommit={(value) =>
                  patchField(guest.id, partyId, { tags: value })
                }
                options={tagSuggestions}
                value={guest.tags}
              />
              <GridBoolCell
                ariaLabel="Child"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { is_child: value })
                }
                value={guest.is_child}
              />
              <GridBoolCell
                ariaLabel="Drinking"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { is_drinking: value })
                }
                value={guest.is_drinking}
              />
              <GridBoolCell
                ariaLabel="Placeholder"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { is_placeholder: value })
                }
                value={guest.is_placeholder}
              />
              {renderParty ? (
                <GridReadOnlyCell>{renderParty(guest)}</GridReadOnlyCell>
              ) : null}
              <GridReadOnlyCell className="text-right">
                <div className="flex justify-end gap-1">
                  <TooltipIconButton
                    label={`Edit ${guest.full_name}`}
                    onClick={() => onEditGuest(guest)}
                  >
                    <Pencil />
                  </TooltipIconButton>
                  <TooltipIconButton
                    disabled={deleteGuest.isPending}
                    label={`Delete ${guest.full_name}`}
                    onClick={() => handleDelete(guest)}
                  >
                    <Trash2 />
                  </TooltipIconButton>
                </div>
              </GridReadOnlyCell>
            </TableRow>
          );
        })}

        {addPartyId && adding ? (
          <TableRow className="bg-muted/30">
            <GridBoolCell
              ariaLabel="New guest primary"
              onCommit={(value) => setDraftField("isPrimary", value)}
              value={draft.isPrimary}
            />
            <GridTextCell
              ariaLabel="New guest name"
              autoFocus
              commitOnChange
              onCommit={(value) => setDraftField("fullName", value)}
              onEnter={handleCreate}
              placeholder="Guest name..."
              value={draft.fullName}
            />
            <GridTextCell
              ariaLabel="New guest email"
              commitOnChange
              onCommit={(value) => setDraftField("email", value)}
              onEnter={handleCreate}
              placeholder="Optional"
              type="email"
              value={draft.email}
            />
            <GridTextCell
              ariaLabel="New guest phone"
              commitOnChange
              onCommit={(value) => setDraftField("phone", value)}
              onEnter={handleCreate}
              placeholder="Optional"
              value={draft.phone}
            />
            <GridChipsCell
              ariaLabel="New guest tags"
              creatable
              onCommit={(value) => setDraftField("tags", value)}
              options={tagSuggestions}
              placeholder="Optional"
              value={draft.tags}
            />
            <GridBoolCell
              ariaLabel="New guest child"
              onCommit={(value) => setDraftField("isChild", value)}
              value={draft.isChild}
            />
            <GridBoolCell
              ariaLabel="New guest drinking"
              onCommit={(value) => setDraftField("isDrinking", value)}
              value={draft.isDrinking}
            />
            <GridBoolCell
              ariaLabel="New guest placeholder"
              onCommit={(value) => setDraftField("isPlaceholder", value)}
              value={draft.isPlaceholder}
            />
            <GridReadOnlyCell className="text-right">
              <div className="flex justify-end gap-1">
                <TooltipIconButton label="Cancel" onClick={cancelAdd}>
                  <X />
                </TooltipIconButton>
                <Button
                  disabled={!canCreate || createGuest.isPending}
                  onClick={handleCreate}
                  size="sm"
                >
                  <Plus />
                  Add
                </Button>
              </div>
            </GridReadOnlyCell>
          </TableRow>
        ) : addPartyId ? (
          <TableRow>
            <TableCell className="p-0" colSpan={9}>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                onClick={() => setAdding(true)}
                type="button"
              >
                <Plus className="size-4" />
                Add guest
              </button>
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

function HeaderWithHint({ label, hint }: { label: string; hint: string }) {
  return (
    <span className="inline-flex items-center justify-center gap-1">
      {label}
      <InfoHint text={hint} />
    </span>
  );
}
