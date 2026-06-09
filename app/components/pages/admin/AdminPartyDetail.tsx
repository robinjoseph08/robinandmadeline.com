import { ArrowLeft, Pencil } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

import { GuestsGrid } from "@/components/pages/admin/grid/GuestsGrid";
import { CopyButton } from "@/components/pages/admin/parties/CopyButton";
import { GuestFormDialog } from "@/components/pages/admin/parties/GuestFormDialog";
import { InfoStatusBadge } from "@/components/pages/admin/parties/InfoStatusBadge";
import {
  INVITATION_TYPE_OPTIONS,
  labelFor,
  RELATION_OPTIONS,
  SIDE_OPTIONS,
} from "@/components/pages/admin/parties/options";
import { PartyFormDialog } from "@/components/pages/admin/parties/PartyFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useUpdateGuest } from "@/hooks/queries/guests";
import {
  useMarkInfo,
  useParty,
  useRequestInfo,
  useUpdateParty,
} from "@/hooks/queries/parties";
import { infoLinkForToken } from "@/libraries/clipboard";
import {
  StatusComplete,
  StatusIncomplete,
  type Guest,
} from "@/types/generated/models";
import type {
  CreateGuestPayload,
  CreatePartyPayload,
} from "@/types/generated/parties";

/**
 * Admin party detail: edits a single party (full edit via the dialog for the
 * mailing address), drives the info-collection actions (request info, mark
 * complete/incomplete, copy the info link / RSVP code), and manages the party's
 * guests as an editable spreadsheet with a trailing add row. Inline cell edits go
 * through PATCH; the guest edit dialog survives for dietary restrictions and
 * table/seat. The single-primary invariant is enforced by the API, so after a
 * write the refetched party shows exactly one primary.
 */
export default function AdminPartyDetail() {
  const { id } = useParams<{ id: string }>();
  const partyQuery = useParty(id);

  const updateParty = useUpdateParty();
  const requestInfo = useRequestInfo();
  const markInfo = useMarkInfo();
  const updateGuest = useUpdateGuest();

  const [editPartyOpen, setEditPartyOpen] = useState(false);
  const [editGuest, setEditGuest] = useState<Guest | undefined>(undefined);
  const [editGuestOpen, setEditGuestOpen] = useState(false);

  if (partyQuery.isLoading) {
    return <p className="text-muted-foreground">Loading party...</p>;
  }
  if (partyQuery.isError || !partyQuery.data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-destructive">
          {partyQuery.error?.message ?? "Party not found."}
        </p>
      </div>
    );
  }

  const party = partyQuery.data;
  const guests = party.guests ?? [];

  const handleUpdateParty = async (payload: CreatePartyPayload) => {
    if (!id) return;
    try {
      await updateParty.mutateAsync({ partyId: id, payload });
      toast.success("Party updated");
      setEditPartyOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update party",
      );
    }
  };

  const handleRequestInfo = async () => {
    if (!id) return;
    try {
      await requestInfo.mutateAsync({ partyId: id });
      toast.success("Info requested; status reset to waiting");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to request info",
      );
    }
  };

  const handleMarkInfo = async (
    status: typeof StatusComplete | typeof StatusIncomplete,
  ) => {
    if (!id) return;
    try {
      await markInfo.mutateAsync({ partyId: id, payload: { status } });
      toast.success(
        status === StatusComplete ? "Marked complete" : "Marked incomplete",
      );
    } catch (error) {
      // The 422 from mark-complete (required fields missing) lands here with its
      // message from the error envelope.
      toast.error(
        error instanceof Error ? error.message : "Failed to update status",
      );
    }
  };

  const openEditGuest = (guest: Guest) => {
    setEditGuest(guest);
    setEditGuestOpen(true);
  };

  const handleEditGuest = async (payload: CreateGuestPayload) => {
    if (!id || !editGuest) return;
    try {
      await updateGuest.mutateAsync({
        guestId: editGuest.id,
        partyId: id,
        payload,
      });
      toast.success("Guest updated");
      setEditGuestOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update guest",
      );
    }
  };

  return (
    <div className="space-y-8">
      <BackLink />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{party.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {labelFor(SIDE_OPTIONS, party.side)}
            </Badge>
            <Badge variant="outline">
              {labelFor(RELATION_OPTIONS, party.relation)}
            </Badge>
            <Badge variant="outline">
              {labelFor(INVITATION_TYPE_OPTIONS, party.invitation_type)}
            </Badge>
            {party.circle.map((c) => (
              <Badge key={c} variant="secondary">
                {c}
              </Badge>
            ))}
          </div>
        </div>
        <Button onClick={() => setEditPartyOpen(true)} variant="outline">
          <Pencil />
          Edit party
        </Button>
      </div>

      <section className="space-y-3 rounded-md border border-ink/10 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Info collection:</span>
            <InfoStatusBadge
              requested={party.info_collection_requested}
              status={party.info_collection_status}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={requestInfo.isPending}
              onClick={handleRequestInfo}
              size="sm"
              variant="outline"
            >
              Request info
            </Button>
            <Button
              disabled={markInfo.isPending}
              onClick={() => handleMarkInfo(StatusComplete)}
              size="sm"
              variant="outline"
            >
              Mark complete
            </Button>
            <Button
              disabled={markInfo.isPending}
              onClick={() => handleMarkInfo(StatusIncomplete)}
              size="sm"
              variant="outline"
            >
              Mark incomplete
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton
            label="Copy info link"
            onCopy={handleRequestInfo}
            successMessage="Info link copied; party marked as requested"
            value={infoLinkForToken(party.info_token)}
          />
          {party.rsvp_code ? (
            <CopyButton
              label="Copy RSVP code"
              successMessage="RSVP code copied"
              value={party.rsvp_code}
            />
          ) : (
            <span className="self-center text-sm text-muted-foreground">
              No RSVP code set
            </span>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">
          Guests{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({guests.length})
          </span>
        </h2>
        <div className="rounded-md border border-ink/10">
          <GuestsGrid<Guest>
            addPartyId={id}
            guests={guests}
            onEditGuest={openEditGuest}
            partyIdFor={() => id ?? ""}
          />
        </div>
      </section>

      <PartyFormDialog
        isPending={updateParty.isPending}
        onOpenChange={setEditPartyOpen}
        onSubmit={handleUpdateParty}
        open={editPartyOpen}
        party={party}
      />

      <GuestFormDialog
        guest={editGuest}
        isPending={updateGuest.isPending}
        onOpenChange={setEditGuestOpen}
        onSubmit={handleEditGuest}
        open={editGuestOpen}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      to="/admin/parties"
    >
      <ArrowLeft className="size-4" />
      Back to parties
    </Link>
  );
}
