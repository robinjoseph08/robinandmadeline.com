import { Pencil, Plus, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { InfoStatusBadge } from "@/components/pages/admin/parties/InfoStatusBadge";
import {
  INVITATION_TYPE_OPTIONS,
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
  PartyResponse,
  PatchGuestPayload,
} from "@/types/generated/parties";

import {
  FROZEN_FIRST_COL,
  FROZEN_FIRST_COL_STATIC,
  FROZEN_ROW,
  GridBoolCell,
  GridChipsCell,
  GridComboboxCell,
  GridCreatablePartyCell,
  GridFlagsCell,
  GridReadOnlyCell,
  GridTextCell,
  type FlagOption,
} from "./cells";
import { Chip } from "./Chip";
import { InfoHint, TooltipIconButton } from "./grid-buttons";

// Tooltip copy for the guest flags. Primary keeps its own header hint; the
// other two are surfaced on the chips inside the Flags cell.
const FLAG_HINTS = {
  primary:
    "The party's main contact (one per party). Their email is required to mark the party's info complete.",
  child: "Guest is a child, for meal and seating planning.",
  drinking: "Guest drinks alcohol, for bar and beverage counts.",
};

// Header hint for the editable Placeholder column (the descriptor of an
// unnamed plus-one slot, e.g. "Guest of John Doe"). Clearing the cell turns
// the guest back into a regular guest.
const PLACEHOLDER_TEXT_HINT =
  'The descriptor of an unnamed plus-one slot (e.g. "Guest of John Doe"). It is permanent: naming the guest never erases it. Clear it to make this a regular guest.';

const NEW_PARTY_PRIMARY_HINT =
  "The first guest of a new party is automatically its primary.";

const PRIMARY_LOCK_HINT =
  "The party's primary. Check another guest to make them the primary instead.";

const SUBSCRIBED_HINT =
  "Whether the guest receives broadcast email updates (ADR 0009). New guests are subscribed; unchecking opts them out, and they can be resubscribed.";

// The two boolean flags collapsed into one chip multi-select, each chip
// carrying its own tooltip in the dropdown.
const GUEST_FLAG_OPTIONS: FlagOption[] = [
  { key: "is_child", label: "Child", hint: FLAG_HINTS.child },
  { key: "is_drinking", label: "Drinking", hint: FLAG_HINTS.drinking },
];

interface GuestsGridProps<TGuest extends Guest> {
  guests: TGuest[];
  /** Party id used to scope each guest write's cache invalidation. */
  partyIdFor: (guest: TGuest) => string;
  /** Opens the full-edit dialog (the same fields, in a focused form). */
  onEditGuest: (guest: TGuest) => void;
  /**
   * Flat-list mode: every party (the full response), so the Party column becomes
   * editable (reassign a guest), the add row can pick or create a party, and the
   * read-only party-attribute columns (side, relation, circle, invitation,
   * address, rsvp, info status) resolve from the guest's party. Mutually
   * exclusive with addPartyId.
   */
  parties?: PartyResponse[];
  /**
   * Detail-page mode: the add row creates a guest in this one party, and the
   * party-context columns are hidden (the party is implicit). Mutually exclusive
   * with parties.
   */
  addPartyId?: string;
  /**
   * The known tags to offer in every tag cell's combobox, typically every tag in
   * use across all parties (see useAllGuestTags). Merged with the tags on the
   * loaded guests, so a tag that exists elsewhere can be applied here even when
   * no loaded guest currently carries it. Omitting it falls back to just the
   * loaded guests' tags; the party detail page passes the global set so its one
   * party is not limited to the tags it already uses.
   */
  tagOptions?: string[];
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
  placeholderText: string;
}

const EMPTY_DRAFT: GuestDraft = {
  fullName: "",
  email: "",
  phone: "",
  tags: [],
  isPrimary: false,
  isChild: false,
  isDrinking: false,
  placeholderText: "",
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
    draft.placeholderText === "" &&
    draft.partyId === undefined &&
    draft.newPartyName === undefined &&
    draft.side === undefined &&
    draft.relation === undefined
  );
}

/**
 * The guest list as an editable spreadsheet, shared by the flat guest list and a
 * party's detail page. Each cell saves itself via PATCH on blur/Enter (a brief
 * tint confirms the save); the child/drinking flags collapse into one chip cell,
 * tags is a creatable colored-chip multi-select, and the Placeholder column is
 * the editable descriptor of an unnamed plus-one slot (clearing it makes the
 * guest a regular one). The single primary is enforced by the API: the current
 * primary's checkbox is locked (promote another guest to move it), and deleting
 * it promotes the next guest.
 *
 * In flat-list mode (parties given) the add row's Party picker is creatable:
 * choose an existing party and its Side/Relation show read-only, or type a new
 * name to create the party with this guest as its primary (Side and Relation
 * become required; invitation defaults to physical). The detail page adds
 * straight into its own party. Every editable guest field is a column (dietary
 * restrictions, table/seat numbers, and the email-subscription flag included);
 * the edit dialog (onEditGuest) survives as a focused form over the same fields.
 * The flat list also surfaces the whole owning party read-only alongside the
 * editable Party picker, so the guest list reads as a single pane of glass.
 */
export function GuestsGrid<TGuest extends Guest>({
  guests,
  partyIdFor,
  onEditGuest,
  parties,
  addPartyId,
  tagOptions,
}: GuestsGridProps<TGuest>) {
  const patchGuest = usePatchGuest();
  const deleteGuest = useDeleteGuest();

  const showPartyColumn = parties !== undefined;
  const canAdd = addPartyId !== undefined || parties !== undefined;
  const partyOptions = useMemo(
    () => (parties ?? []).map((p) => ({ value: p.id, label: p.name })),
    [parties],
  );
  const partyById = useMemo(() => {
    const map = new Map<string, PartyResponse>();
    for (const party of parties ?? []) map.set(party.id, party);
    return map;
  }, [parties]);
  // Guest columns (always): Name, Email, Phone, Tags, Flags, Placeholder,
  // Primary, Dietary, Table, Seat, Subscribed, Actions (12). The flat list adds
  // the editable Party picker plus the read-only party-attribute columns: Side,
  // Relation, Circle, Invitation, Address 1, Address 2, City, State, Postal,
  // Country, RSVP code, Info status (13).
  const columnCount = 12 + (showPartyColumn ? 13 : 0);

  // Tags to suggest in every tag cell: the known set (tagOptions, typically
  // every tag across all parties) merged with the tags already on the loaded
  // guests, de-duplicated case-insensitively and sorted. Listing the known set
  // first lets its casing win a collision; merging the loaded guests keeps a tag
  // just typed on one of them selectable in the brief window before the global
  // set refetches, and keeps the cell working when no tagOptions are supplied.
  const tagSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const all: string[] = [];
    const addTag = (tag: string) => {
      const key = tag.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        all.push(tag);
      }
    };
    for (const tag of tagOptions ?? []) addTag(tag);
    for (const guest of guests) for (const tag of guest.tags) addTag(tag);
    return all.sort((a, b) => a.localeCompare(b));
  }, [guests, tagOptions]);

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
        {/* Group banner over the two column families, so the wide flat list reads
            as "guest data | party data" at a glance. Only the flat list has the
            party family; the detail page is all guest columns, so it is skipped. */}
        {showPartyColumn ? (
          <TableRow>
            {/* Split the Guest banner so its first cell freezes with the Name
                column below it; the rest of the guest columns scroll. */}
            <TableHead className={FROZEN_FIRST_COL_STATIC}>Guest</TableHead>
            <TableHead colSpan={10} />
            <TableHead className="border-l border-ink/10" colSpan={13}>
              Party
            </TableHead>
            <TableHead />
          </TableRow>
        ) : null}
        <TableRow>
          <TableHead className={`${FROZEN_FIRST_COL_STATIC} min-w-40`}>
            Name
          </TableHead>
          <TableHead className="min-w-48">Email</TableHead>
          <TableHead className="min-w-36">Phone</TableHead>
          <TableHead className="min-w-40">Tags</TableHead>
          <TableHead className="min-w-40">Flags</TableHead>
          <TableHead className="min-w-40">
            <HeaderWithHint hint={PLACEHOLDER_TEXT_HINT} label="Placeholder" />
          </TableHead>
          <TableHead className="w-24 text-center">
            <HeaderWithHint hint={FLAG_HINTS.primary} label="Primary" />
          </TableHead>
          <TableHead className="min-w-40">Dietary</TableHead>
          <TableHead className="w-20">Table</TableHead>
          <TableHead className="w-20">Seat</TableHead>
          <TableHead className="w-28 text-center">
            <HeaderWithHint hint={SUBSCRIBED_HINT} label="Subscribed" />
          </TableHead>
          {showPartyColumn ? (
            <>
              <TableHead className="min-w-44 border-l border-ink/10">
                Party
              </TableHead>
              <TableHead className="w-28">Side</TableHead>
              <TableHead className="w-28">Relation</TableHead>
              <TableHead className="min-w-40">Circle</TableHead>
              <TableHead className="w-28">Invitation</TableHead>
              <TableHead className="min-w-44">Address line 1</TableHead>
              <TableHead className="min-w-36">Address line 2</TableHead>
              <TableHead className="min-w-32">City</TableHead>
              <TableHead className="min-w-28">State / province</TableHead>
              <TableHead className="min-w-28">Postal code</TableHead>
              <TableHead className="min-w-28">Country</TableHead>
              <TableHead className="w-28">RSVP code</TableHead>
              <TableHead className="w-40">Info status</TableHead>
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
            <TableRow className={FROZEN_ROW} key={guest.id}>
              <GridTextCell
                ariaLabel="Name"
                cellClassName={FROZEN_FIRST_COL}
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
                phoneFormat
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
                  })
                }
                options={GUEST_FLAG_OPTIONS}
                value={{
                  is_child: guest.is_child,
                  is_drinking: guest.is_drinking,
                }}
              />
              <GridTextCell
                ariaLabel="Placeholder text"
                // Clearing the cell stores NULL, turning the row back into a
                // regular guest; the descriptor itself stays admin-editable
                // (e.g. retargeting a slot after a swap).
                onCommit={(value) =>
                  patchField(guest.id, partyId, { placeholder_text: value })
                }
                placeholder="None"
                value={guest.placeholder_text ?? ""}
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
              <GridTextCell
                ariaLabel="Dietary restrictions"
                onCommit={(value) =>
                  patchField(guest.id, partyId, {
                    dietary_restrictions: value,
                  })
                }
                placeholder="None"
                value={guest.dietary_restrictions ?? ""}
              />
              <GridTextCell
                ariaLabel="Table number"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { table_number: value })
                }
                placeholder="None"
                type="number"
                value={guest.table_number?.toString() ?? ""}
              />
              <GridTextCell
                ariaLabel="Seat number"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { seat_number: value })
                }
                placeholder="None"
                type="number"
                value={guest.seat_number?.toString() ?? ""}
              />
              <GridBoolCell
                ariaLabel="Subscribed"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { subscribed: value })
                }
                value={guest.subscribed}
              />
              {showPartyColumn ? (
                <>
                  <GridComboboxCell
                    ariaLabel="Party"
                    className="border-l border-ink/10"
                    onCommit={(value) =>
                      patchField(guest.id, partyId, { party_id: value })
                    }
                    options={partyOptions}
                    value={guest.party_id}
                  />
                  <ReadOnlySideChip party={party} />
                  <ReadOnlyAttr
                    value={
                      party ? labelFor(RELATION_OPTIONS, party.relation) : ""
                    }
                  />
                  <PartyExtraCells party={party} />
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

        {canAdd ? (
          <AddGuestRow
            addPartyId={addPartyId}
            columnCount={columnCount}
            parties={parties}
            partyById={partyById}
            showPartyColumn={showPartyColumn}
            tagSuggestions={tagSuggestions}
          />
        ) : null}
      </TableBody>
    </Table>
  );
}

interface AddGuestRowProps {
  parties?: PartyResponse[];
  addPartyId?: string;
  showPartyColumn: boolean;
  partyById: Map<string, PartyResponse>;
  tagSuggestions: string[];
  /** Span of the collapsed "Add guest" affordance, matching GuestsGrid's columns. */
  columnCount: number;
}

/**
 * The spreadsheet's add row, which owns its own draft. Keeping the draft here
 * rather than in GuestsGrid means typing a new guest re-renders only this row, not
 * the (potentially hundreds of) existing guest rows above it, so entry stays
 * responsive on a long list.
 *
 * It renders the "Add guest" affordance until opened, then a full editable row
 * whose cells write straight into the local draft (commitOnChange) and whose Enter
 * submits the new guest. See GuestsGrid for the flat-list vs detail-page modes.
 */
function AddGuestRow({
  parties,
  addPartyId,
  showPartyColumn,
  partyById,
  tagSuggestions,
  columnCount,
}: AddGuestRowProps) {
  const createGuest = useCreateGuest();
  const createPartyWithGuest = useCreatePartyWithGuest();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<GuestDraft>(EMPTY_DRAFT);

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

  const creating = createGuest.isPending || createPartyWithGuest.isPending;

  const handleCreate = async () => {
    // The Add button disables itself while a create is in flight, but the
    // add-row Enter path lands here directly; ignore it rather than firing a
    // duplicate POST.
    if (creating) return;
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
      // A blank cell means a regular guest; the key is dropped so the API
      // stores NULL rather than rejecting a blank descriptor.
      placeholder_text: draft.placeholderText.trim() || undefined,
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

  if (!adding) {
    return (
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
    );
  }

  // Each placeholder shows an example of the column's contents rather than
  // "Optional": when the add row sits below a long guest list the header has
  // scrolled away, so the example is what identifies which field a cell is.
  return (
    <TableRow className="bg-muted/30">
      <GridTextCell
        ariaLabel="New guest name"
        autoFocus
        cellClassName={FROZEN_FIRST_COL_STATIC}
        commitOnChange
        onCommit={(value) => setDraftField("fullName", value)}
        onEnter={handleCreate}
        onEscape={handleAddRowEscape}
        placeholder="e.g. Jane Smith"
        showStatus={false}
        value={draft.fullName}
      />
      <GridTextCell
        ariaLabel="New guest email"
        commitOnChange
        onCommit={(value) => setDraftField("email", value)}
        onEnter={handleCreate}
        onEscape={handleAddRowEscape}
        placeholder="e.g. jane@example.com"
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
        phoneFormat
        placeholder="e.g. (415) 555-2671"
        showStatus={false}
        value={draft.phone}
      />
      <GridChipsCell
        ariaLabel="New guest tags"
        creatable
        onCommit={(value) => setDraftField("tags", value)}
        options={tagSuggestions}
        placeholder="e.g. Cousin, Bridal Party"
        showStatus={false}
        value={draft.tags}
      />
      <GridFlagsCell
        ariaLabel="New guest flags"
        onCommit={(value) => {
          setDraftField("isChild", value.is_child);
          setDraftField("isDrinking", value.is_drinking);
        }}
        options={GUEST_FLAG_OPTIONS}
        placeholder="e.g. Child, Drinking"
        showStatus={false}
        value={{
          is_child: draft.isChild,
          is_drinking: draft.isDrinking,
        }}
      />
      <GridTextCell
        ariaLabel="New guest placeholder text"
        commitOnChange
        onCommit={(value) => setDraftField("placeholderText", value)}
        onEnter={handleCreate}
        onEscape={handleAddRowEscape}
        placeholder="e.g. Guest of Jane Smith"
        showStatus={false}
        value={draft.placeholderText}
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
      {/* Dietary restrictions and the seating numbers are not part of the
          quick-add (they are filled in inline on the row once the guest exists),
          so they sit empty here, keeping the add row aligned with the columns. */}
      <EmptyCell />
      <EmptyCell />
      <EmptyCell />
      {/* A new guest is always created subscribed (ADR 0009); the box shows that
          intent, locked, and the flag becomes editable on the saved row. */}
      <GridBoolCell
        ariaLabel="New guest subscribed"
        disabled
        onCommit={() => {}}
        showStatus={false}
        tooltip="New guests receive email updates by default; change it after adding."
        value={true}
      />
      {showPartyColumn ? (
        <>
          <GridCreatablePartyCell
            className="border-l border-ink/10"
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
                renderOption={(o) => (
                  <Chip colorKey={o.value} label={o.label} />
                )}
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
              <ReadOnlySideChip party={draftExistingParty} />
              <ReadOnlyAttr
                value={
                  draftExistingParty
                    ? labelFor(RELATION_OPTIONS, draftExistingParty.relation)
                    : ""
                }
              />
            </>
          )}
          {/* The rest of the party attributes are read-only: they show the
              selected party's values, or blank while a new party is being typed
              (it has none yet). */}
          <PartyExtraCells
            party={isNewParty ? undefined : draftExistingParty}
          />
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
  );
}

/**
 * A read-only party-attribute cell (Side/Relation and the rest of the party
 * columns in the flat list). A present value reads muted (the read-only signal);
 * an empty one falls back to a lighter "None" that matches the editable cells'
 * placeholder muting (text-ink/40), so a blank read-only cell reads as empty
 * rather than as a real value.
 */
function ReadOnlyAttr({ value }: { value: string }) {
  return (
    <GridReadOnlyCell className="p-0">
      <div className="flex h-8 items-center px-3 text-sm">
        {value ? (
          <span className="text-muted-foreground">{value}</span>
        ) : (
          <span className="text-ink/40">None</span>
        )}
      </div>
    </GridReadOnlyCell>
  );
}

/**
 * A read-only multi-value cell rendering its values as the same colored chips the
 * editable chips cell uses on the parties grid (Circle), so the two lists read
 * alike. Chips clip on overflow to keep the row height uniform; an empty set
 * falls back to the lighter "None" placeholder, like ReadOnlyAttr.
 */
function ReadOnlyChips({ values }: { values: string[] }) {
  return (
    <GridReadOnlyCell className="p-0">
      <div className="flex h-8 items-center overflow-hidden px-3">
        {values.length === 0 ? (
          <span className="text-sm text-ink/40">None</span>
        ) : (
          <span className="flex items-center gap-1">
            {values.map((item) => (
              <Chip key={item} label={item} />
            ))}
          </span>
        )}
      </div>
    </GridReadOnlyCell>
  );
}

/**
 * The read-only Side cell on the guest list: the owning party's side as a colored
 * chip (blue for Robin, pink for Madeline), matching the editable Side chip on
 * the parties grid so the value reads the same whether or not it is editable
 * here. Only the Party picker changes it. Empty falls back to "None".
 */
function ReadOnlySideChip({ party }: { party?: PartyResponse }) {
  return (
    <GridReadOnlyCell className="p-0">
      <div className="flex h-8 items-center px-3">
        {party ? (
          <Chip
            colorKey={party.side}
            label={labelFor(SIDE_OPTIONS, party.side)}
          />
        ) : (
          <span className="text-sm text-ink/40">None</span>
        )}
      </div>
    </GridReadOnlyCell>
  );
}

/** An empty add-row cell, a placeholder under a column the quick-add skips. */
function EmptyCell() {
  return (
    <GridReadOnlyCell className="p-0">
      <div className="h-8" />
    </GridReadOnlyCell>
  );
}

/**
 * The read-only tail of the party-attribute columns in the flat list (everything
 * past Side/Relation): circle, invitation, the mailing address, the RSVP code,
 * and the derived info-collection status. They are never editable here, only the
 * Party picker is; changing it re-resolves every one of these from the new party.
 * A missing party (the add row's new-party case) renders them blank.
 */
function PartyExtraCells({ party }: { party?: PartyResponse }) {
  return (
    <>
      <ReadOnlyChips values={party?.circle ?? []} />
      <ReadOnlyAttr
        value={
          party ? labelFor(INVITATION_TYPE_OPTIONS, party.invitation_type) : ""
        }
      />
      <ReadOnlyAttr value={party?.address_line_1 ?? ""} />
      <ReadOnlyAttr value={party?.address_line_2 ?? ""} />
      <ReadOnlyAttr value={party?.city ?? ""} />
      <ReadOnlyAttr value={party?.state_or_province ?? ""} />
      <ReadOnlyAttr value={party?.postal_code ?? ""} />
      <ReadOnlyAttr value={party?.country ?? ""} />
      <ReadOnlyAttr value={party?.rsvp_code ?? ""} />
      <GridReadOnlyCell className="p-0">
        <div className="flex h-8 items-center px-3">
          {party ? (
            <InfoStatusBadge
              missingRequiredFields={party.missing_required_fields}
              requested={party.info_collection_requested}
              status={party.info_collection_status}
            />
          ) : null}
        </div>
      </GridReadOnlyCell>
    </>
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
