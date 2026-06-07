import { ArrowLeft, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";

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
  useUpdateGuest,
} from "@/hooks/queries/guests";
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
 * Admin party detail: shows and edits a single party, exposes the
 * info-collection actions (request info, mark complete which surfaces the 422
 * when required fields are missing, mark incomplete), copy buttons for the info
 * link and RSVP code, and the party's guests in a table with inline
 * create/edit/delete. The single-primary invariant is enforced by the API; after
 * a guest write the refetched party shows exactly one primary.
 */
export default function AdminPartyDetail() {
  const { id } = useParams<{ id: string }>();
  const partyQuery = useParty(id);

  const updateParty = useUpdateParty();
  const requestInfo = useRequestInfo();
  const markInfo = useMarkInfo();
  const createGuest = useCreateGuest();
  const updateGuest = useUpdateGuest();
  const deleteGuest = useDeleteGuest();

  const [editPartyOpen, setEditPartyOpen] = useState(false);
  const [guestDialogOpen, setGuestDialogOpen] = useState(false);
  const [editingGuest, setEditingGuest] = useState<Guest | undefined>(
    undefined,
  );

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

  const openCreateGuest = () => {
    setEditingGuest(undefined);
    setGuestDialogOpen(true);
  };

  const openEditGuest = (guest: Guest) => {
    setEditingGuest(guest);
    setGuestDialogOpen(true);
  };

  const handleGuestSubmit = async (payload: CreateGuestPayload) => {
    if (!id) return;
    try {
      if (editingGuest) {
        await updateGuest.mutateAsync({
          guestId: editingGuest.id,
          partyId: id,
          payload,
        });
        toast.success("Guest updated");
      } else {
        await createGuest.mutateAsync({ partyId: id, payload });
        toast.success("Guest added");
      }
      setGuestDialogOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to save guest",
      );
    }
  };

  const handleDeleteGuest = async (guest: Guest) => {
    if (!id) return;
    if (!window.confirm(`Delete ${guest.full_name}?`)) return;
    try {
      await deleteGuest.mutateAsync({ guestId: guest.id, partyId: id });
      toast.success("Guest deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete guest",
      );
    }
  };

  const guestSubmitting = createGuest.isPending || updateGuest.isPending;

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
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">
            Guests{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({guests.length})
            </span>
          </h2>
          <Button onClick={openCreateGuest} size="sm">
            <Plus />
            Add guest
          </Button>
        </div>

        {guests.length === 0 ? (
          <p className="text-muted-foreground">
            No guests yet. Add the primary guest to get started.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Flags</TableHead>
                <TableHead>Seat</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {guests.map((guest) => (
                <TableRow key={guest.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {guest.is_primary ? (
                        <Star
                          aria-label="Primary guest"
                          className="size-3.5 fill-current text-complementary-2"
                        />
                      ) : null}
                      {guest.full_name}
                    </span>
                  </TableCell>
                  <TableCell>{guest.email ?? "--"}</TableCell>
                  <TableCell>
                    {guest.roles.length > 0 ? guest.roles.join(", ") : "--"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {guest.is_primary ? (
                        <Badge variant="default">Primary</Badge>
                      ) : null}
                      {guest.is_child ? (
                        <Badge variant="secondary">Child</Badge>
                      ) : null}
                      {guest.is_drinking ? (
                        <Badge variant="secondary">Drinking</Badge>
                      ) : null}
                      {guest.is_placeholder ? (
                        <Badge variant="outline">Placeholder</Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    {guest.table_number != null || guest.seat_number != null
                      ? `T${guest.table_number ?? "?"} / S${guest.seat_number ?? "?"}`
                      : "--"}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        aria-label={`Edit ${guest.full_name}`}
                        onClick={() => openEditGuest(guest)}
                        size="icon"
                        variant="ghost"
                      >
                        <Pencil />
                      </Button>
                      <Button
                        aria-label={`Delete ${guest.full_name}`}
                        disabled={deleteGuest.isPending}
                        onClick={() => handleDeleteGuest(guest)}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <PartyFormDialog
        isPending={updateParty.isPending}
        onOpenChange={setEditPartyOpen}
        onSubmit={handleUpdateParty}
        open={editPartyOpen}
        party={party}
      />

      <GuestFormDialog
        guest={editingGuest}
        isPending={guestSubmitting}
        onOpenChange={setGuestDialogOpen}
        onSubmit={handleGuestSubmit}
        open={guestDialogOpen}
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
