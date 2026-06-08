import { Pencil, Plus, Trash2 } from "lucide-react";
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
  PatchPartyPayload,
} from "@/types/generated/parties";

import {
  GridEnumCell,
  GridMultiSelectCell,
  GridReadOnlyCell,
  GridTextCell,
} from "./cells";

interface PartiesGridProps {
  parties: PartyResponse[];
  /** Opens the full-edit dialog (mailing address and other long-tail fields). */
  onEditParty: (party: PartyResponse) => void;
}

interface PartyDraft {
  name: string;
  side: Side;
  relation: Relation;
  invitationType: InvitationType;
  circle: Circle[];
  rsvpCode: string;
}

const EMPTY_DRAFT: PartyDraft = {
  name: "",
  side: SideRobin,
  relation: RelationFamily,
  invitationType: InvitationPhysical,
  circle: [],
  rsvpCode: "",
};

/**
 * The parties list as an editable spreadsheet: each cell saves itself via PATCH
 * the moment you leave it (Tab to the next column, Enter down to the next row),
 * and the trailing row creates a new party as soon as you fill its name and press
 * Enter. The mailing address and other long-tail fields stay behind the edit
 * dialog (onEditParty); the derived status and guest count are read-only, and the
 * copy actions behave as before (copying the info link also requests info).
 */
export function PartiesGrid({ parties, onEditParty }: PartiesGridProps) {
  const patchParty = usePatchParty();
  const createParty = useCreateParty();
  const deleteParty = useDeleteParty();
  const requestInfo = useRequestInfo();

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

  const handleCreate = async () => {
    const name = draft.name.trim();
    if (!name) return;
    const payload: CreatePartyPayload = {
      name,
      side: draft.side,
      relation: draft.relation,
      circle: draft.circle,
      invitation_type: draft.invitationType,
      rsvp_code: draft.rsvpCode.trim() || undefined,
    };
    try {
      await createParty.mutateAsync(payload);
      toast.success(`Created "${name}"`);
      setDraft(EMPTY_DRAFT);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to create party",
      );
    }
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
          <TableHead className="w-40 text-right">Actions</TableHead>
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
            <GridEnumCell<Side>
              ariaLabel="Side"
              onCommit={(value) => patchField(party.id, { side: value })}
              options={SIDE_OPTIONS}
              value={party.side}
            />
            <GridEnumCell<Relation>
              ariaLabel="Relation"
              onCommit={(value) => patchField(party.id, { relation: value })}
              options={RELATION_OPTIONS}
              value={party.relation}
            />
            <GridEnumCell<InvitationType>
              ariaLabel="Invitation"
              onCommit={(value) =>
                patchField(party.id, { invitation_type: value })
              }
              options={INVITATION_TYPE_OPTIONS}
              value={party.invitation_type}
            />
            <GridMultiSelectCell<Circle>
              ariaLabel="Circle"
              onCommit={(value) => patchField(party.id, { circle: value })}
              options={CIRCLE_OPTIONS}
              value={party.circle}
            />
            <GridTextCell
              ariaLabel="RSVP code"
              onCommit={(value) => patchField(party.id, { rsvp_code: value })}
              placeholder="None"
              value={party.rsvp_code ?? ""}
            />
            <GridReadOnlyCell>
              <Link
                className="font-medium hover:underline"
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
                  label="Info link"
                  onCopy={async () => {
                    await requestInfo.mutateAsync({ partyId: party.id });
                  }}
                  successMessage="Info link copied; party marked as requested"
                  value={infoLinkForToken(party.info_token)}
                />
                {party.rsvp_code ? (
                  <CopyButton
                    label="RSVP"
                    successMessage="RSVP code copied"
                    value={party.rsvp_code}
                  />
                ) : null}
                <Button
                  aria-label={`Edit ${party.name}`}
                  onClick={() => onEditParty(party)}
                  size="icon"
                  variant="ghost"
                >
                  <Pencil />
                </Button>
                <Button
                  aria-label={`Delete ${party.name}`}
                  disabled={deleteParty.isPending}
                  onClick={() => handleDelete(party)}
                  size="icon"
                  variant="ghost"
                >
                  <Trash2 />
                </Button>
              </div>
            </GridReadOnlyCell>
          </TableRow>
        ))}

        {/* The add row: fill the name and press Enter (or click Add) to create. */}
        <TableRow className="bg-muted/30">
          <GridTextCell
            ariaLabel="New party name"
            commitOnChange
            onCommit={(value) => setDraftField("name", value)}
            onEnter={handleCreate}
            placeholder="Add a party..."
            value={draft.name}
          />
          <GridEnumCell<Side>
            ariaLabel="New party side"
            onCommit={(value) => setDraftField("side", value)}
            options={SIDE_OPTIONS}
            value={draft.side}
          />
          <GridEnumCell<Relation>
            ariaLabel="New party relation"
            onCommit={(value) => setDraftField("relation", value)}
            options={RELATION_OPTIONS}
            value={draft.relation}
          />
          <GridEnumCell<InvitationType>
            ariaLabel="New party invitation"
            onCommit={(value) => setDraftField("invitationType", value)}
            options={INVITATION_TYPE_OPTIONS}
            value={draft.invitationType}
          />
          <GridMultiSelectCell<Circle>
            ariaLabel="New party circle"
            onCommit={(value) => setDraftField("circle", value)}
            options={CIRCLE_OPTIONS}
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
            <Button
              disabled={createParty.isPending || draft.name.trim() === ""}
              onClick={handleCreate}
              size="sm"
            >
              <Plus />
              Add
            </Button>
          </GridReadOnlyCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
