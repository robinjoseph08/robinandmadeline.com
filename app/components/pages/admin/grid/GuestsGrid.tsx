import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
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
  GridComboboxCell,
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

interface PartyOption {
  id: string;
  name: string;
}

interface GuestsGridProps<TGuest extends Guest> {
  guests: TGuest[];
  /** Party id used to scope each guest write's cache invalidation. */
  partyIdFor: (guest: TGuest) => string;
  /** Opens the full-edit dialog (dietary restrictions, table/seat numbers). */
  onEditGuest: (guest: TGuest) => void;
  /**
   * Flat-list mode: every party, so the Party column becomes an editable combobox
   * (reassign a guest) and the add row includes a party picker. Mutually
   * exclusive with addPartyId.
   */
  parties?: PartyOption[];
  /**
   * Detail-page mode: the add row creates a guest in this one party, and no Party
   * column is shown (the party is implicit). Mutually exclusive with parties.
   */
  addPartyId?: string;
}

interface GuestDraft {
  partyId?: string;
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

/**
 * The guest list as an editable spreadsheet, shared by the flat guest list and a
 * party's detail page. Each cell saves itself via PATCH on blur/Enter; the four
 * flags are inline checkboxes (with info tooltips in their headers), tags is a
 * searchable, creatable, colored-chip multi-select, and promoting a guest to
 * primary demotes the party's previous primary (enforced by the API). Both pages
 * can add a guest from a trailing row: the detail page targets its own party,
 * while the flat list shows an editable Party combobox (per row and in the add
 * row) so a guest can be assigned or moved between parties. Dietary restrictions
 * and table/seat numbers stay behind the edit dialog (onEditGuest).
 */
export function GuestsGrid<TGuest extends Guest>({
  guests,
  partyIdFor,
  onEditGuest,
  parties,
  addPartyId,
}: GuestsGridProps<TGuest>) {
  const patchGuest = usePatchGuest();
  const createGuest = useCreateGuest();
  const deleteGuest = useDeleteGuest();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<GuestDraft>(EMPTY_DRAFT);

  const showPartyColumn = parties !== undefined;
  const canAdd = addPartyId !== undefined || parties !== undefined;
  const partyOptions = useMemo(
    () => (parties ?? []).map((p) => ({ value: p.id, label: p.name })),
    [parties],
  );
  const columnCount = 8 + (showPartyColumn ? 1 : 0) + 1;

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

  const targetPartyId = addPartyId ?? draft.partyId;
  const canCreate = draft.fullName.trim() !== "" && Boolean(targetPartyId);

  const handleCreate = async () => {
    if (!canCreate || !targetPartyId) return;
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
      await createGuest.mutateAsync({ partyId: targetPartyId, payload });
      toast.success(`Added ${payload.full_name}`);
      // Keep the add row open for rapid entry; in the flat list keep the chosen
      // party so several guests can be added to it in a row.
      setDraft((prev) => ({ ...EMPTY_DRAFT, partyId: prev.partyId }));
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
          {showPartyColumn ? (
            <TableHead className="min-w-44">Party</TableHead>
          ) : null}
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
              {showPartyColumn ? (
                <GridComboboxCell
                  ariaLabel="Party"
                  onCommit={(value) =>
                    patchField(guest.id, partyId, { party_id: value })
                  }
                  options={partyOptions}
                  value={guest.party_id}
                />
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

        {canAdd && adding ? (
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
            {showPartyColumn ? (
              <GridComboboxCell
                ariaLabel="New guest party"
                onCommit={(value) => setDraftField("partyId", value)}
                options={partyOptions}
                placeholder="Party..."
                value={draft.partyId}
              />
            ) : null}
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
        ) : canAdd ? (
          <TableRow>
            <TableCell className="p-0" colSpan={columnCount}>
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
