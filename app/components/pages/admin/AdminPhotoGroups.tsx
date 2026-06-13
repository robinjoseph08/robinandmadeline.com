import { ArrowDown, ArrowUp, Pencil, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Combobox } from "@/components/library/Combobox";
import { TooltipIconButton } from "@/components/pages/admin/grid/grid-buttons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useGuests } from "@/hooks/queries/guests";
import {
  useAddPhotoGroupGuest,
  useCreatePhotoGroup,
  useDeletePhotoGroup,
  usePhotoGroups,
  useRemovePhotoGroupGuest,
  useReorderPhotoGroups,
  useUpdatePhotoGroup,
} from "@/hooks/queries/photo-groups";
import { ApiError } from "@/libraries/admin-api";
import type { GuestListItem } from "@/types/generated/parties";
import type { PhotoGroupResponse } from "@/types/generated/photogroups";

/**
 * Admin "Group Photos" page (named to match the guest-facing schedule
 * section): the photographer's shot list for the one photo session between
 * the ceremony and the reception. One flat list in shooting order; the admin
 * can create, rename, and delete groups (delete confirms through a dialog),
 * move them up and down the order, and assign or remove guests. The
 * guest-facing schedule shows each party the groups its guests are in, with
 * their positions, so the order here is what guests see.
 */
export default function AdminPhotoGroups() {
  const groupsQuery = usePhotoGroups();
  // The flat, unfiltered guest list feeds every group's add-guest picker.
  const guestsQuery = useGuests();
  const createGroup = useCreatePhotoGroup();
  const reorderGroups = useReorderPhotoGroups();
  const deleteGroup = useDeletePhotoGroup();

  const [newName, setNewName] = useState("");
  // The group the delete dialog is confirming for, plus a separate open flag
  // (mirroring AdminEvents' dialog state): closing keeps the target rendered
  // through the exit animation instead of flashing a nameless "Delete ?".
  const [deleteTarget, setDeleteTarget] = useState<PhotoGroupResponse | null>(
    null,
  );
  const [deleteOpen, setDeleteOpen] = useState(false);

  const groups = groupsQuery.data?.items ?? [];
  const guests = guestsQuery.data?.items ?? [];

  // The guest list feeds every add-guest picker, so its loading and failure
  // states are the page's too (otherwise a failed fetch would render as "No
  // matching guests.").
  const isLoading = groupsQuery.isLoading || guestsQuery.isLoading;
  const error = groupsQuery.error ?? guestsQuery.error;

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await createGroup.mutateAsync({ name });
      toast.success(`Added ${name}`);
      setNewName("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add photo group",
      );
    }
  };

  // Swaps the group at index with its neighbor and submits the full id
  // sequence (the API requires every group exactly once).
  const handleMove = async (index: number, direction: -1 | 1) => {
    const ids = groups.map((g) => g.id);
    const target = index + direction;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      await reorderGroups.mutateAsync({ photo_group_ids: ids });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to reorder groups",
      );
    }
  };

  // Runs after the dialog's explicit confirm; the dialog (not window.confirm)
  // is the gate, so the row's delete button only ever opens it. On failure
  // the dialog stays open for a retry, except a 404: the group already being
  // gone (deleted from another tab or device) is the state the admin asked
  // for, so closing beats wedging the dialog in a retry loop. Either way the
  // mutation's settled invalidation refreshes the list behind the dialog.
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteGroup.mutateAsync({ photoGroupId: deleteTarget.id });
      toast.success("Photo group deleted");
      setDeleteOpen(false);
    } catch (error) {
      if (error instanceof ApiError && error.code === "not_found") {
        toast.success("Photo group deleted");
        setDeleteOpen(false);
        return;
      }
      toast.error(
        error instanceof Error ? error.message : "Failed to delete group",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Group Photos</h1>
        <p className="text-sm text-muted-foreground">
          The photographer's shot list for the photo session between the
          ceremony and the reception, in shooting order. Guests see their groups
          and positions on their schedule.
        </p>
      </div>

      {isLoading ? (
        <p className="text-muted-foreground">Loading photo groups...</p>
      ) : error ? (
        <p className="text-destructive">{error.message}</p>
      ) : (
        <>
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No photo groups yet. Add the first one below.
            </p>
          ) : (
            <ul className="space-y-2">
              {groups.map((group, index) => (
                <GroupRow
                  count={groups.length}
                  group={group}
                  guests={guests}
                  index={index}
                  key={group.id}
                  onDelete={() => {
                    setDeleteTarget(group);
                    setDeleteOpen(true);
                  }}
                  onMove={(direction) => handleMove(index, direction)}
                  reordering={reorderGroups.isPending}
                />
              ))}
            </ul>
          )}

          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <Input
              aria-label="New photo group name"
              className="w-64"
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New group name"
              value={newName}
            />
            <Button
              disabled={newName.trim() === "" || createGroup.isPending}
              type="submit"
            >
              <Plus />
              Add group
            </Button>
          </form>
        </>
      )}

      {/* The delete confirmation. One dialog for the whole page, pointed at
          the row whose delete button opened it. */}
      <Dialog
        onOpenChange={(open) => {
          // Dismissal (Escape, overlay click, the corner X) is ignored while
          // the delete is in flight: closing mid-request would read as an
          // abort the request would not honor.
          if (!open && !deleteGroup.isPending) setDeleteOpen(false);
        }}
        open={deleteOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deleteTarget?.name}?</DialogTitle>
            <DialogDescription>
              This removes the group from the shooting order; its guest
              assignments go with it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={deleteGroup.isPending}
              onClick={() => setDeleteOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              disabled={deleteGroup.isPending}
              onClick={() => void handleDelete()}
              type="button"
              variant="destructive"
            >
              Delete group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface GroupRowProps {
  group: PhotoGroupResponse;
  index: number;
  count: number;
  guests: GuestListItem[];
  /** Opens the page's delete-confirmation dialog for this group. */
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  reordering: boolean;
}

/**
 * One photo group: its position in the shooting order, reorder and
 * rename/delete controls, and its members with the add-guest picker. The
 * delete button only opens the page's confirmation dialog; the dialog owns
 * the actual delete.
 */
function GroupRow({
  group,
  index,
  count,
  guests,
  onDelete,
  onMove,
  reordering,
}: GroupRowProps) {
  const updateGroup = useUpdatePhotoGroup();
  const addGuest = useAddPhotoGroupGuest();
  const removeGuest = useRemovePhotoGroupGuest();

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(group.name);

  const memberIDs = useMemo(
    () => new Set(group.guests.map((member) => member.guest_id)),
    [group.guests],
  );
  const guestOptions = useMemo(
    () =>
      guests
        .filter((guest) => !memberIDs.has(guest.id))
        .map((guest) => ({
          value: guest.id,
          label: `${guest.full_name} (${guest.party_name})`,
        })),
    [guests, memberIDs],
  );

  const handleRename = async () => {
    const name = editName.trim();
    if (!name) return;
    try {
      await updateGroup.mutateAsync({
        photoGroupId: group.id,
        payload: { name },
      });
      toast.success("Photo group renamed");
      setEditing(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to rename group",
      );
    }
  };

  const handleAddGuest = async (guestId: string | undefined) => {
    if (!guestId) return;
    try {
      await addGuest.mutateAsync({
        photoGroupId: group.id,
        payload: { guest_id: guestId },
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add guest",
      );
    }
  };

  const handleRemoveGuest = async (guestId: string, guestName: string) => {
    try {
      await removeGuest.mutateAsync({ photoGroupId: group.id, guestId });
      toast.success(`Removed ${guestName} from ${group.name}`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to remove guest",
      );
    }
  };

  return (
    <li className="space-y-2 rounded-md border border-ink/10 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Group {index + 1} of {count}
        </span>
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleRename();
            }}
          >
            <Input
              aria-label={`Photo group name for ${group.name}`}
              autoFocus
              className="w-64"
              onChange={(e) => setEditName(e.target.value)}
              value={editName}
            />
            <Button
              disabled={editName.trim() === "" || updateGroup.isPending}
              size="sm"
              type="submit"
            >
              Save
            </Button>
            <Button
              onClick={() => {
                setEditing(false);
                setEditName(group.name);
              }}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
          </form>
        ) : (
          <span className="font-medium">{group.name}</span>
        )}

        <div className="ml-auto flex gap-1">
          <TooltipIconButton
            disabled={index === 0 || reordering}
            label={`Move ${group.name} up`}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </TooltipIconButton>
          <TooltipIconButton
            disabled={index === count - 1 || reordering}
            label={`Move ${group.name} down`}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </TooltipIconButton>
          <TooltipIconButton
            label={`Rename ${group.name}`}
            onClick={() => {
              setEditName(group.name);
              setEditing(true);
            }}
          >
            <Pencil />
          </TooltipIconButton>
          <TooltipIconButton label={`Delete ${group.name}`} onClick={onDelete}>
            <X />
          </TooltipIconButton>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {group.guests.length === 0 ? (
          <span className="text-sm text-muted-foreground">
            No guests assigned yet.
          </span>
        ) : (
          group.guests.map((member) => (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-ink/10 bg-muted/50 py-1 pl-3 pr-1 text-sm"
              key={member.guest_id}
            >
              {member.guest_name} ({member.party_name})
              <button
                aria-label={`Remove ${member.guest_name} from ${group.name}`}
                className="cursor-pointer rounded-full p-1 opacity-50 outline-none hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring"
                onClick={() =>
                  void handleRemoveGuest(member.guest_id, member.guest_name)
                }
                type="button"
              >
                <X className="size-3" />
              </button>
            </span>
          ))
        )}
        <Combobox
          ariaLabel={`Add guest to ${group.name}`}
          emptyText="No matching guests."
          onChange={(guestId) => void handleAddGuest(guestId)}
          options={guestOptions}
          placeholder="Add guest..."
          searchPlaceholder="Search guests..."
          triggerClassName="h-8 w-44 rounded-full border border-dashed border-ink/20 text-sm"
        />
      </div>
    </li>
  );
}
