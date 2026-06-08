import { Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { CopyButton } from "@/components/pages/admin/parties/CopyButton";
import { InfoStatusBadge } from "@/components/pages/admin/parties/InfoStatusBadge";
import {
  CIRCLE_OPTIONS,
  INVITATION_TYPE_OPTIONS,
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
  useCreateParty,
  useDeleteParty,
  usePatchParty,
  useRequestInfo,
} from "@/hooks/queries/parties";
import { infoLinkForToken } from "@/libraries/clipboard";
import type {
  Circle,
  InvitationType,
  Relation,
  Side,
} from "@/types/generated/models";
import type {
  CreatePartyPayload,
  PartyResponse,
  PatchPartyPayload,
} from "@/types/generated/parties";

import {
  GridChipsCell,
  GridComboboxCell,
  GridReadOnlyCell,
  GridTextCell,
} from "./cells";
import { TooltipIconButton } from "./grid-buttons";

const CIRCLE_VALUES = CIRCLE_OPTIONS.map((option) => option.value);

interface PartiesGridProps {
  parties: PartyResponse[];
  /** Opens the full-edit dialog (mailing address and other long-tail fields). */
  onEditParty: (party: PartyResponse) => void;
}

interface PartyDraft {
  name: string;
  side?: Side;
  relation?: Relation;
  invitationType?: InvitationType;
  circle: Circle[];
  rsvpCode: string;
}

const EMPTY_DRAFT: PartyDraft = {
  name: "",
  circle: [],
  rsvpCode: "",
};

/**
 * The parties list as an editable spreadsheet: each cell saves itself via PATCH
 * the moment you leave it (Tab to the next column, Enter down to the next row).
 * The add row is opened on demand with the "Add party" button and dismissed with
 * its cancel button; its enum cells start blank and creation is blocked until the
 * required fields (name, side, relation, invitation) are set. The mailing address
 * and other long-tail fields stay behind the edit dialog (onEditParty); the
 * derived status and guest count are read-only, and copying the info link also
 * requests info.
 */
export function PartiesGrid({ parties, onEditParty }: PartiesGridProps) {
  const patchParty = usePatchParty();
  const createParty = useCreateParty();
  const deleteParty = useDeleteParty();
  const requestInfo = useRequestInfo();

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PartyDraft>(EMPTY_DRAFT);

  // Save one field. Resolves to void on success; toasts and re-throws on failure
  // so the cell rolls its optimistic value back to what the server still holds.
  const patchField = (
    partyId: string,
    payload: PatchPartyPayload,
  ): Promise<void> =>
    patchParty.mutateAsync({ partyId, payload }).then(
      () => undefined,
      (error: unknown) => {
        toast.error(error instanceof Error ? error.message : "Failed to save");
        throw error;
      },
    );

  const setDraftField = <K extends keyof PartyDraft>(
    key: K,
    value: PartyDraft[K],
  ) => setDraft((prev) => ({ ...prev, [key]: value }));

  const canCreate =
    draft.name.trim() !== "" &&
    Boolean(draft.side) &&
    Boolean(draft.relation) &&
    Boolean(draft.invitationType);

  const handleCreate = async () => {
    if (!canCreate) return;
    const payload: CreatePartyPayload = {
      name: draft.name.trim(),
      side: draft.side as Side,
      relation: draft.relation as Relation,
      circle: draft.circle,
      invitation_type: draft.invitationType as InvitationType,
      rsvp_code: draft.rsvpCode.trim() || undefined,
    };
    try {
      await createParty.mutateAsync(payload);
      toast.success(`Created "${payload.name}"`);
      setDraft(EMPTY_DRAFT); // keep the add row open for rapid entry
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create party",
      );
    }
  };

  const cancelAdd = () => {
    setAdding(false);
    setDraft(EMPTY_DRAFT);
  };

  const handleDelete = async (party: PartyResponse) => {
    if (!window.confirm(`Delete ${party.name}? This removes its guests too.`)) {
      return;
    }
    try {
      await deleteParty.mutateAsync({ partyId: party.id });
      toast.success("Party deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete party",
      );
    }
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-44">Name</TableHead>
          <TableHead className="w-32">Side</TableHead>
          <TableHead className="w-32">Relation</TableHead>
          <TableHead className="w-32">Invitation</TableHead>
          <TableHead className="min-w-40">Circle</TableHead>
          <TableHead className="w-32">RSVP code</TableHead>
          <TableHead className="w-20">Guests</TableHead>
          <TableHead className="w-40">Info status</TableHead>
          <TableHead className="w-32 text-right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {parties.map((party) => (
          <TableRow key={party.id}>
            <GridTextCell
              ariaLabel="Name"
              onCommit={(value) => patchField(party.id, { name: value })}
              value={party.name}
            />
            <GridComboboxCell
              ariaLabel="Side"
              onCommit={(value) =>
                patchField(party.id, { side: value as Side })
              }
              options={SIDE_OPTIONS}
              value={party.side}
            />
            <GridComboboxCell
              ariaLabel="Relation"
              onCommit={(value) =>
                patchField(party.id, { relation: value as Relation })
              }
              options={RELATION_OPTIONS}
              value={party.relation}
            />
            <GridComboboxCell
              ariaLabel="Invitation"
              onCommit={(value) =>
                patchField(party.id, {
                  invitation_type: value as InvitationType,
                })
              }
              options={INVITATION_TYPE_OPTIONS}
              value={party.invitation_type}
            />
            <GridChipsCell
              ariaLabel="Circle"
              onCommit={(value) =>
                patchField(party.id, { circle: value as Circle[] })
              }
              options={CIRCLE_VALUES}
              value={party.circle}
            />
            <GridTextCell
              ariaLabel="RSVP code"
              onCommit={(value) => patchField(party.id, { rsvp_code: value })}
              placeholder="None"
              value={party.rsvp_code ?? ""}
            />
            <GridReadOnlyCell className="p-0">
              <Link
                className="flex h-full min-h-9 w-full items-center px-3 font-medium transition-colors hover:bg-muted/40 hover:underline"
                title="View guests"
                to={`/admin/parties/${party.id}`}
              >
                {party.guests?.length ?? 0}
              </Link>
            </GridReadOnlyCell>
            <GridReadOnlyCell>
              <InfoStatusBadge
                requested={party.info_collection_requested}
                status={party.info_collection_status}
              />
            </GridReadOnlyCell>
            <GridReadOnlyCell className="text-right">
              <div className="flex justify-end gap-1">
                <CopyButton
                  icon={<Link2 />}
                  iconOnly
                  label="Copy info link (marks requested)"
                  onCopy={async () => {
                    await requestInfo.mutateAsync({ partyId: party.id });
                  }}
                  successMessage="Info link copied; party marked as requested"
                  value={infoLinkForToken(party.info_token)}
                />
                {party.rsvp_code ? (
                  <CopyButton
                    iconOnly
                    label="Copy RSVP code"
                    successMessage="RSVP code copied"
                    value={party.rsvp_code}
                  />
                ) : null}
                <TooltipIconButton
                  label={`Edit ${party.name}`}
                  onClick={() => onEditParty(party)}
                >
                  <Pencil />
                </TooltipIconButton>
                <TooltipIconButton
                  disabled={deleteParty.isPending}
                  label={`Delete ${party.name}`}
                  onClick={() => handleDelete(party)}
                >
                  <Trash2 />
                </TooltipIconButton>
              </div>
            </GridReadOnlyCell>
          </TableRow>
        ))}

        {adding ? (
          <TableRow className="bg-muted/30">
            <GridTextCell
              ariaLabel="New party name"
              autoFocus
              commitOnChange
              onCommit={(value) => setDraftField("name", value)}
              onEnter={handleCreate}
              placeholder="Party name..."
              value={draft.name}
            />
            <GridComboboxCell
              ariaLabel="New party side"
              onCommit={(value) => setDraftField("side", value as Side)}
              options={SIDE_OPTIONS}
              placeholder="Side..."
              value={draft.side}
            />
            <GridComboboxCell
              ariaLabel="New party relation"
              onCommit={(value) => setDraftField("relation", value as Relation)}
              options={RELATION_OPTIONS}
              placeholder="Relation..."
              value={draft.relation}
            />
            <GridComboboxCell
              ariaLabel="New party invitation"
              onCommit={(value) =>
                setDraftField("invitationType", value as InvitationType)
              }
              options={INVITATION_TYPE_OPTIONS}
              placeholder="Invitation..."
              value={draft.invitationType}
            />
            <GridChipsCell
              ariaLabel="New party circle"
              onCommit={(value) => setDraftField("circle", value as Circle[])}
              options={CIRCLE_VALUES}
              value={draft.circle}
            />
            <GridTextCell
              ariaLabel="New party RSVP code"
              commitOnChange
              onCommit={(value) => setDraftField("rsvpCode", value)}
              onEnter={handleCreate}
              placeholder="Optional"
              value={draft.rsvpCode}
            />
            <GridReadOnlyCell />
            <GridReadOnlyCell />
            <GridReadOnlyCell className="text-right">
              <div className="flex justify-end gap-1">
                <TooltipIconButton label="Cancel" onClick={cancelAdd}>
                  <X />
                </TooltipIconButton>
                <Button
                  disabled={!canCreate || createParty.isPending}
                  onClick={handleCreate}
                  size="sm"
                >
                  <Plus />
                  Add
                </Button>
              </div>
            </GridReadOnlyCell>
          </TableRow>
        ) : (
          <TableRow>
            <TableCell className="p-0" colSpan={9}>
              <button
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                onClick={() => setAdding(true)}
                type="button"
              >
                <Plus className="size-4" />
                Add party
              </button>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
