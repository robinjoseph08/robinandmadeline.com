import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
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
  GridReadOnlyCell,
  GridRolesCell,
  GridTextCell,
} from "./cells";

interface GuestsGridProps<TGuest extends Guest> {
  guests: TGuest[];
  /** Party id used to scope each guest write's cache invalidation. */
  partyIdFor: (guest: TGuest) => string;
  /** Opens the full-edit dialog (dietary restrictions, table/seat numbers). */
  onEditGuest: (guest: TGuest) => void;
  /** Renders the trailing party cell (the flat list links each guest's party). */
  renderParty?: (guest: TGuest) => ReactNode;
  /** When set, shows an add row that creates a guest in this party. */
  addPartyId?: string;
}

interface GuestDraft {
  fullName: string;
  email: string;
  phone: string;
  roles: string[];
  isPrimary: boolean;
  isChild: boolean;
  isDrinking: boolean;
  isPlaceholder: boolean;
}

const EMPTY_DRAFT: GuestDraft = {
  fullName: "",
  email: "",
  phone: "",
  roles: [],
  isPrimary: false,
  isChild: false,
  isDrinking: false,
  isPlaceholder: false,
};

/**
 * The guest list as an editable spreadsheet, shared by the flat guest list and a
 * party's detail page. Each cell saves itself via PATCH on blur/Enter; the four
 * flags are inline checkboxes, roles is a comma-separated cell, and promoting a
 * guest to primary demotes the party's previous primary (enforced by the API).
 * The flat list passes renderParty to link each guest back to its party; the
 * detail page passes addPartyId to show a trailing row that adds a guest. Dietary
 * restrictions and table/seat numbers stay behind the edit dialog (onEditGuest).
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

  const [draft, setDraft] = useState<GuestDraft>(EMPTY_DRAFT);

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

  const handleCreate = async () => {
    const fullName = draft.fullName.trim();
    if (!fullName || !addPartyId) return;
    const payload: CreateGuestPayload = {
      full_name: fullName,
      email: draft.email.trim() || undefined,
      phone: draft.phone.trim() || undefined,
      roles: draft.roles,
      is_primary: draft.isPrimary,
      is_child: draft.isChild,
      is_drinking: draft.isDrinking,
      is_placeholder: draft.isPlaceholder,
    };
    try {
      await createGuest.mutateAsync({ partyId: addPartyId, payload });
      toast.success(`Added ${fullName}`);
      setDraft(EMPTY_DRAFT);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add guest",
      );
    }
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
          <TableHead className="w-20 text-center">Primary</TableHead>
          <TableHead className="min-w-40">Name</TableHead>
          <TableHead className="min-w-48">Email</TableHead>
          <TableHead className="w-36">Phone</TableHead>
          <TableHead className="min-w-40">Roles</TableHead>
          <TableHead className="w-16 text-center">Child</TableHead>
          <TableHead className="w-20 text-center">Drinking</TableHead>
          <TableHead className="w-24 text-center">Placeholder</TableHead>
          {renderParty ? <TableHead className="w-40">Party</TableHead> : null}
          <TableHead className="w-24 text-right">Actions</TableHead>
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
              <GridRolesCell
                ariaLabel="Roles"
                onCommit={(value) =>
                  patchField(guest.id, partyId, { roles: value })
                }
                placeholder="None"
                value={guest.roles}
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
                  <Button
                    aria-label={`Edit ${guest.full_name}`}
                    onClick={() => onEditGuest(guest)}
                    size="icon"
                    variant="ghost"
                  >
                    <Pencil />
                  </Button>
                  <Button
                    aria-label={`Delete ${guest.full_name}`}
                    disabled={deleteGuest.isPending}
                    onClick={() => handleDelete(guest)}
                    size="icon"
                    variant="ghost"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </GridReadOnlyCell>
            </TableRow>
          );
        })}

        {addPartyId ? (
          <TableRow className="bg-muted/30">
            <GridBoolCell
              ariaLabel="New guest primary"
              onCommit={(value) => setDraftField("isPrimary", value)}
              value={draft.isPrimary}
            />
            <GridTextCell
              ariaLabel="New guest name"
              commitOnChange
              onCommit={(value) => setDraftField("fullName", value)}
              onEnter={handleCreate}
              placeholder="Add a guest..."
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
            <GridRolesCell
              ariaLabel="New guest roles"
              commitOnChange
              onCommit={(value) => setDraftField("roles", value)}
              onEnter={handleCreate}
              placeholder="Optional"
              value={draft.roles}
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
              <Button
                disabled={createGuest.isPending || draft.fullName.trim() === ""}
                onClick={handleCreate}
                size="sm"
              >
                <Plus />
                Add
              </Button>
            </GridReadOnlyCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}
