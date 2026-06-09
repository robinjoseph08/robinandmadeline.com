import { Link2, Pencil, Trash2 } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
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

/**
 * The parties list as an editable spreadsheet: each cell saves itself via PATCH
 * the moment you leave it (Tab to the next column, Enter down to the next row).
 * There is no add row here, because parties are created from the guest list (a
 * party is born with its first guest); this grid manages, edits, and deletes
 * existing parties. The mailing address and other long-tail fields stay behind
 * the edit dialog (onEditParty); the derived status and guest count are
 * read-only; copying the info link also requests info; and the RSVP code is
 * upper-cased as you type.
 */
export function PartiesGrid({ parties, onEditParty }: PartiesGridProps) {
  const patchParty = usePatchParty();
  const deleteParty = useDeleteParty();
  const requestInfo = useRequestInfo();

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
          <TableHead className="min-w-32">RSVP code</TableHead>
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
              transform={(value) => value.toUpperCase()}
              value={party.rsvp_code ?? ""}
            />
            <GridReadOnlyCell className="p-0">
              <Link
                className="flex h-8 w-full items-center px-3 font-medium transition-colors hover:bg-muted/40 hover:underline"
                title="View guests"
                to={`/admin/parties/${party.id}`}
              >
                {party.guests?.length ?? 0}
              </Link>
            </GridReadOnlyCell>
            <GridReadOnlyCell className="p-0">
              <div className="flex h-8 items-center px-3">
                <InfoStatusBadge
                  requested={party.info_collection_requested}
                  status={party.info_collection_status}
                />
              </div>
            </GridReadOnlyCell>
            <GridReadOnlyCell className="p-0">
              <div className="flex h-8 items-center justify-end gap-1 px-3">
                {/* RSVP copy sits left of the info link so the always-present
                    link/edit/delete buttons stay column-aligned across rows
                    whether or not a party has an RSVP code. */}
                {party.rsvp_code ? (
                  <CopyButton
                    iconOnly
                    label="Copy RSVP code"
                    successMessage="RSVP code copied"
                    value={party.rsvp_code}
                  />
                ) : null}
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
      </TableBody>
    </Table>
  );
}
