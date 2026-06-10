import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
  labelFor,
  RELATION_OPTIONS,
  SIDE_OPTIONS,
} from "@/components/pages/admin/parties/options";
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
import { useCreatePartyWithGuest } from "@/hooks/queries/parties";
import { formatPhone } from "@/libraries/phone";
import type { Guest, Relation, Side } from "@/types/generated/models";
import type {
  CreateGuestPayload,
  PatchGuestPayload,
} from "@/types/generated/parties";

import {
  GridBoolCell,
  GridChipsCell,
  GridComboboxCell,
  GridCreatablePartyCell,
  GridFlagsCell,
  GridReadOnlyCell,
  GridTextCell,
  type FlagOption,
} from "./cells";
import { InfoHint, TooltipIconButton } from "./grid-buttons";

// Tooltip copy for the guest flags. Primary keeps its own header hint; the other
// three are surfaced on the chips inside the Flags cell.
const FLAG_HINTS = {
  primary:
    "The party's main contact (one per party). Their email is required to mark the party's info complete.",
  child: "Guest is a child, for meal and seating planning.",
  drinking: "Guest drinks alcohol, for bar and beverage counts.",
  placeholder:
    "A stand-in for an unnamed guest or an unconfirmed plus-one (e.g. a +1 whose name you do not have yet).",
};

const NEW_PARTY_PRIMARY_HINT =
  "The first guest of a new party is automatically its primary.";

const PRIMARY_LOCK_HINT =
  "The party's primary. Check another guest to make them the primary instead.";

// The three boolean flags collapsed into one chip multi-select, each chip
// carrying its own tooltip in the dropdown.
const GUEST_FLAG_OPTIONS: FlagOption[] = [
  { key: "is_child", label: "Child", hint: FLAG_HINTS.child },
  { key: "is_drinking", label: "Drinking", hint: FLAG_HINTS.drinking },
  { key: "is_placeholder", label: "Placeholder", hint: FLAG_HINTS.placeholder },
];

interface PartyOption {
  id: string;
  name: string;
  side: Side;
  relation: Relation;
}

interface GuestsGridProps<TGuest extends Guest> {
  guests: TGuest[];
  /** Party id used to scope each guest write's cache invalidation. */
  partyIdFor: (guest: TGuest) => string;
  /** Opens the full-edit dialog (dietary restrictions, table/seat numbers). */
  onEditGuest: (guest: TGuest) => void;
  /**
   * Flat-list mode: every party, so the Party column becomes editable (reassign a
   * guest) and the add row can pick or create a party (with the Side/Relation
   * columns alongside). Mutually exclusive with addPartyId.
   */
  parties?: PartyOption[];
  /**
   * Detail-page mode: the add row creates a guest in this one party, and the
   * party-context columns are hidden (the party is implicit). Mutually exclusive
   * with parties.
   */
  addPartyId?: string;
}

interface GuestDraft {
  // Party selection: an existing party id, or a new party being created by name.
  partyId?: string;
  newPartyName?: string;
  // New-party fields (used only when newPartyName is set): side and relation are
  // required. invitation_type is not collected here; it defaults to physical and
  // is changed later on the parties grid.
  side?: Side;
  relation?: Relation;
  // Guest fields.
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
 * Whether the add-row draft is still untouched (every field at its EMPTY_DRAFT
 * default). Escape exits add mode only when this holds, so a half-filled row is
 * never discarded by a stray keypress.
 */
function isDraftPristine(draft: GuestDraft): boolean {
  return (
    draft.fullName === "" &&
    draft.email === "" &&
    draft.phone === "" &&
    draft.tags.length === 0 &&
    !draft.isPrimary &&
    !draft.isChild &&
    !draft.isDrinking &&
    !draft.isPlaceholder &&
    draft.partyId === undefined &&
    draft.newPartyName === undefined &&
    draft.side === undefined &&
    draft.relation === undefined
  );
}

/**
 * The guest list as an editable spreadsheet, shared by the flat guest list and a
 * party's detail page. Each cell saves itself via PATCH on blur/Enter (a brief
 * tint confirms the save); the child/drinking/placeholder flags collapse into one
 * chip cell, tags is a creatable colored-chip multi-select, and Primary follows
 * Flags. The single primary is enforced by the API: the current primary's
 * checkbox is locked (promote another guest to move it), and deleting it promotes
 * the next guest.
 *
 * In flat-list mode (parties given) the add row's Party picker is creatable:
 * choose an existing party and its Side/Relation show read-only, or type a new
 * name to create the party with this guest as its primary (Side and Relation
 * become required; invitation defaults to physical). The detail page adds
 * straight into its own party. Dietary restrictions and table/seat numbers stay
 * behind the edit dialog (onEditGuest).
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
  const createPartyWithGuest = useCreatePartyWithGuest();
  const deleteGuest = useDeleteGuest();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<GuestDraft>(EMPTY_DRAFT);

  const showPartyColumn = parties !== undefined;
  const canAdd = addPartyId !== undefined || parties !== undefined;
  const partyOptions = useMemo(
    () => (parties ?? []).map((p) => ({ value: p.id, label: p.name })),
    [parties],
  );
  const partyById = useMemo(() => {
    const map = new Map<string, PartyOption>();
    for (const party of parties ?? []) map.set(party.id, party);
    return map;
  }, [parties]);
  // Base columns: Name, Email, Phone, Tags, Flags, Primary, Actions. The flat
  // list adds Party, Side, Relation.
  const columnCount = 7 + (showPartyColumn ? 3 : 0);

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

  const isNewParty = draft.newPartyName !== undefined;
  const draftExistingParty =
    draft.partyId !== undefined ? partyById.get(draft.partyId) : undefined;
  const targetExistingPartyId = addPartyId ?? draft.partyId;
  const canCreate =
    draft.fullName.trim() !== "" &&
    (addPartyId !== undefined
      ? true
      : isNewParty
        ? Boolean(draft.side) && Boolean(draft.relation)
        : draft.partyId !== undefined);

  // Names the required add-row fields still missing, for the Enter feedback
  // below (mirrors the canCreate conditions).
  const missingForCreate = (): string[] => {
    const missing: string[] = [];
    if (draft.fullName.trim() === "") missing.push("name");
    if (addPartyId === undefined) {
      if (isNewParty) {
        if (!draft.side) missing.push("side");
        if (!draft.relation) missing.push("relation");
      } else if (draft.partyId === undefined) {
        missing.push("party");
      }
    }
    return missing;
  };

  const handleCreate = async () => {
    if (!canCreate) {
      // Only Enter lands here (the Add button is disabled while !canCreate), so
      // name what is missing instead of silently doing nothing.
      const missing = missingForCreate();
      toast.error(
        `Missing required field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
      );
      return;
    }
    const guestFields = {
      full_name: draft.fullName.trim(),
      email: draft.email.trim() || undefined,
      phone: draft.phone.trim() || undefined,
      tags: draft.tags,
      is_child: draft.isChild,
      is_drinking: draft.isDrinking,
      is_placeholder: draft.isPlaceholder,
    };
    try {
      if (isNewParty && draft.newPartyName) {
        // Create the party together with this guest, who becomes its primary.
        // Invitation defaults to physical (changed later on the parties grid).
        await createPartyWithGuest.mutateAsync({
          name: draft.newPartyName.trim(),
          side: draft.side as Side,
          relation: draft.relation as Relation,
          invitation_type: "physical",
          circle: [],
          guest: guestFields,
        });
        toast.success(
          `Added ${guestFields.full_name} to new party ${draft.newPartyName.trim()}`,
        );
      } else if (targetExistingPartyId) {
        const payload: CreateGuestPayload = {
          ...guestFields,
          is_primary: draft.isPrimary,
        };
        await createGuest.mutateAsync({
          partyId: targetExistingPartyId,
          payload,
        });
        toast.success(`Added ${guestFields.full_name}`);
      }
      // Reset every field (party included) so the next guest starts clean.
      setDraft(EMPTY_DRAFT);
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

  // Escape from a draft text cell exits add mode, but only while the row is still
  // untouched, so an in-progress row is never discarded by a stray keypress.
  const handleAddRowEscape = () => {
    if (isDraftPristine(draft)) cancelAdd();
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

  const creating = createGuest.isPending || createPartyWithGuest.isPending;

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-40">Name</TableHead>
          <TableHead className="min-w-48">Email</TableHead>
          <TableHead className="min-w-36">Phone</TableHead>
          <TableHead className="min-w-40">Tags</TableHead>
          <TableHead className="min-w-40">Flags</TableHead>
          <TableHead className="w-24 text-center">
            <HeaderWithHint hint={FLAG_HINTS.primary} label="Primary" />
          </TableHead>
          {showPartyColumn ? (
            <>
              <TableHead className="min-w-44">Party</TableHead>
              <TableHead className="w-28">Side</TableHead>
              <TableHead className="w-28">Relation</TableHead>
            </>
          ) : null}
          <TableHead className="w-20 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {guests.map((guest) => {
          const partyId = partyIdFor(guest);
          const party = partyById.get(guest.party_id);
          return (
            <TableRow key={guest.id}>
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
                // Show the stored E.164 number in a friendly format; the backend
                // re-normalizes whatever is typed back to E.164 on save.
                value={formatPhone(guest.phone ?? "")}
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
              <GridFlagsCell
                ariaLabel="Flags"
                onCommit={(value) =>
                  patchField(guest.id, partyId, {
                    is_child: value.is_child,
                    is_drinking: value.is_drinking,
                    is_placeholder: value.is_placeholder,
                  })
                }
                options={GUEST_FLAG_OPTIONS}
                value={{
                  is_child: guest.is_child,
                  is_drinking: guest.is_drinking,
                  is_placeholder: guest.is_placeholder,
                }}
              />
              <GridBoolCell
                ariaLabel="Primary"
                // The current primary cannot be unchecked (a party must keep one);
                // promote another guest to move it. The tooltip explains the lock.
                disabled={guest.is_primary}
                onCommit={(value) =>
                  patchField(guest.id, partyId, { is_primary: value })
                }
                tooltip={guest.is_primary ? PRIMARY_LOCK_HINT : undefined}
                value={guest.is_primary}
              />
              {showPartyColumn ? (
                <>
                  <GridComboboxCell
                    ariaLabel="Party"
                    onCommit={(value) =>
                      patchField(guest.id, partyId, { party_id: value })
                    }
                    options={partyOptions}
                    value={guest.party_id}
                  />
                  <ReadOnlyAttr
                    value={party ? labelFor(SIDE_OPTIONS, party.side) : ""}
                  />
                  <ReadOnlyAttr
                    value={
                      party ? labelFor(RELATION_OPTIONS, party.relation) : ""
                    }
                  />
                </>
              ) : null}
              <GridReadOnlyCell className="p-0">
                <div className="flex h-8 items-center justify-end gap-1 px-3">
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
            <GridTextCell
              ariaLabel="New guest name"
              autoFocus
              commitOnChange
              onCommit={(value) => setDraftField("fullName", value)}
              onEnter={handleCreate}
              onEscape={handleAddRowEscape}
              placeholder="Guest name..."
              showStatus={false}
              value={draft.fullName}
            />
            <GridTextCell
              ariaLabel="New guest email"
              commitOnChange
              onCommit={(value) => setDraftField("email", value)}
              onEnter={handleCreate}
              onEscape={handleAddRowEscape}
              placeholder="Optional"
              showStatus={false}
              type="email"
              value={draft.email}
            />
            <GridTextCell
              ariaLabel="New guest phone"
              commitOnChange
              onCommit={(value) => setDraftField("phone", value)}
              onEnter={handleCreate}
              onEscape={handleAddRowEscape}
              placeholder="Optional"
              showStatus={false}
              value={draft.phone}
            />
            <GridChipsCell
              ariaLabel="New guest tags"
              creatable
              onCommit={(value) => setDraftField("tags", value)}
              options={tagSuggestions}
              placeholder="Optional"
              showStatus={false}
              value={draft.tags}
            />
            <GridFlagsCell
              ariaLabel="New guest flags"
              onCommit={(value) => {
                setDraftField("isChild", value.is_child);
                setDraftField("isDrinking", value.is_drinking);
                setDraftField("isPlaceholder", value.is_placeholder);
              }}
              options={GUEST_FLAG_OPTIONS}
              placeholder="Optional"
              showStatus={false}
              value={{
                is_child: draft.isChild,
                is_drinking: draft.isDrinking,
                is_placeholder: draft.isPlaceholder,
              }}
            />
            <GridBoolCell
              ariaLabel="New guest primary"
              // A brand-new party's first guest is always its primary, so the box
              // is forced on and explained via a tooltip.
              disabled={isNewParty}
              onCommit={(value) => setDraftField("isPrimary", value)}
              showStatus={false}
              tooltip={isNewParty ? NEW_PARTY_PRIMARY_HINT : undefined}
              value={isNewParty ? true : draft.isPrimary}
            />
            {showPartyColumn ? (
              <>
                <GridCreatablePartyCell
                  newPartyName={draft.newPartyName}
                  onCreateNew={(name) =>
                    setDraft((prev) => ({
                      ...prev,
                      partyId: undefined,
                      newPartyName: name,
                    }))
                  }
                  onSelectExisting={(id) =>
                    setDraft((prev) => ({
                      ...prev,
                      partyId: id,
                      newPartyName: undefined,
                      side: undefined,
                      relation: undefined,
                    }))
                  }
                  parties={parties ?? []}
                  partyId={draft.partyId}
                />
                {isNewParty ? (
                  <>
                    <GridComboboxCell
                      ariaLabel="New party side"
                      onCommit={(value) => setDraftField("side", value as Side)}
                      options={SIDE_OPTIONS}
                      placeholder="Side..."
                      showStatus={false}
                      value={draft.side}
                    />
                    <GridComboboxCell
                      ariaLabel="New party relation"
                      onCommit={(value) =>
                        setDraftField("relation", value as Relation)
                      }
                      options={RELATION_OPTIONS}
                      placeholder="Relation..."
                      showStatus={false}
                      value={draft.relation}
                    />
                  </>
                ) : (
                  <>
                    <ReadOnlyAttr
                      value={
                        draftExistingParty
                          ? labelFor(SIDE_OPTIONS, draftExistingParty.side)
                          : ""
                      }
                    />
                    <ReadOnlyAttr
                      value={
                        draftExistingParty
                          ? labelFor(
                              RELATION_OPTIONS,
                              draftExistingParty.relation,
                            )
                          : ""
                      }
                    />
                  </>
                )}
              </>
            ) : null}
            <GridReadOnlyCell className="p-0">
              <div className="flex h-8 items-center justify-end gap-1 px-3">
                <TooltipIconButton label="Cancel" onClick={cancelAdd}>
                  <X />
                </TooltipIconButton>
                <Button
                  disabled={!canCreate || creating}
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

/** A read-only party-attribute cell (Side/Relation in the flat list). */
function ReadOnlyAttr({ value }: { value: string }) {
  return (
    <GridReadOnlyCell className="p-0">
      <div className="flex h-8 items-center px-3 text-sm text-muted-foreground">
        {value || "None"}
      </div>
    </GridReadOnlyCell>
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
