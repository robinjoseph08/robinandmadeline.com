import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import {
  BoolFilterSelect,
  FilterSelect,
} from "@/components/pages/admin/parties/FilterSelect";
import { GuestFormDialog } from "@/components/pages/admin/parties/GuestFormDialog";
import {
  CIRCLE_OPTIONS,
  RELATION_OPTIONS,
  SIDE_OPTIONS,
} from "@/components/pages/admin/parties/options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useDeleteGuest,
  useGuests,
  useUpdateGuest,
} from "@/hooks/queries/guests";
import type { Circle, Relation, Side } from "@/types/generated/models";
import type {
  CreateGuestPayload,
  GuestListItem,
  ListGuestsQuery,
} from "@/types/generated/parties";

/**
 * Admin flat guest list: every guest across all parties in a filterable table.
 * Filters cover the party-level attributes (side, relation, circle) and the
 * guest-level ones (roles contains, plus the drinking/child/placeholder flags).
 * Event- and RSVP-status filters are deferred to #6 (they need the event model).
 *
 * A guest is a sub-entity of its party and has no detail page of its own, so the
 * Party column links to the owning party by name, and each row is edited in
 * place via the shared GuestFormDialog (seeded with the guest and its party_id,
 * which the update mutation needs for cache invalidation and the single-primary
 * swap) or deleted with a confirmation.
 */
export default function AdminGuests() {
  const [filters, setFilters] = useState<ListGuestsQuery>({});
  // Local text state for the roles "contains" filter, committed to the query.
  const [rolesInput, setRolesInput] = useState("");

  const guestsQuery = useGuests(filters);
  const guests = guestsQuery.data?.items ?? [];

  const updateGuest = useUpdateGuest();
  const deleteGuest = useDeleteGuest();

  const [editGuestOpen, setEditGuestOpen] = useState(false);
  const [editingGuest, setEditingGuest] = useState<GuestListItem | undefined>(
    undefined,
  );

  const setFilter = <K extends keyof ListGuestsQuery>(
    key: K,
    value: ListGuestsQuery[K],
  ) => setFilters((prev) => ({ ...prev, [key]: value }));

  const commitRoles = () => {
    const trimmed = rolesInput.trim();
    setFilter("roles", trimmed === "" ? undefined : trimmed);
  };

  const openEditGuest = (guest: GuestListItem) => {
    setEditingGuest(guest);
    setEditGuestOpen(true);
  };

  const handleGuestSubmit = async (payload: CreateGuestPayload) => {
    if (!editingGuest) return;
    try {
      await updateGuest.mutateAsync({
        guestId: editingGuest.id,
        partyId: editingGuest.party_id,
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

  const handleDeleteGuest = async (guest: GuestListItem) => {
    if (!window.confirm(`Delete ${guest.full_name}?`)) return;
    try {
      await deleteGuest.mutateAsync({
        guestId: guest.id,
        partyId: guest.party_id,
      });
      toast.success("Guest deleted");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to delete guest",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Guests</h1>
        <p className="text-sm text-muted-foreground">
          {guestsQuery.data
            ? `${guestsQuery.data.total} guest${guestsQuery.data.total === 1 ? "" : "s"}`
            : "Every guest across all parties."}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <FilterSelect<Side>
          label="Side"
          onChange={(v) => setFilter("side", v)}
          options={SIDE_OPTIONS}
          value={filters.side as Side | undefined}
        />
        <FilterSelect<Relation>
          label="Relation"
          onChange={(v) => setFilter("relation", v)}
          options={RELATION_OPTIONS}
          value={filters.relation as Relation | undefined}
        />
        <FilterSelect<Circle>
          label="Circle"
          onChange={(v) => setFilter("circle", v)}
          options={CIRCLE_OPTIONS}
          value={filters.circle as Circle | undefined}
        />
        <BoolFilterSelect
          label="Drinking"
          onChange={(v) => setFilter("is_drinking", v)}
          value={filters.is_drinking}
        />
        <BoolFilterSelect
          label="Child"
          onChange={(v) => setFilter("is_child", v)}
          value={filters.is_child}
        />
        <BoolFilterSelect
          label="Placeholder"
          onChange={(v) => setFilter("is_placeholder", v)}
          value={filters.is_placeholder}
        />
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Role contains</span>
          <Input
            className="w-40"
            onBlur={commitRoles}
            onChange={(e) => setRolesInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRoles();
            }}
            placeholder="e.g. Bridesmaid"
            value={rolesInput}
          />
        </label>
      </div>

      {guestsQuery.isLoading ? (
        <p className="text-muted-foreground">Loading guests...</p>
      ) : guestsQuery.isError ? (
        <p className="text-destructive">{guestsQuery.error.message}</p>
      ) : guests.length === 0 ? (
        <p className="text-muted-foreground">No guests match these filters.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead>Party</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {guests.map((guest) => (
              <TableRow key={guest.id}>
                <TableCell className="font-medium">{guest.full_name}</TableCell>
                <TableCell>{guest.email ?? "--"}</TableCell>
                <TableCell>{guest.phone ?? "--"}</TableCell>
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
                  <Link
                    className="text-sm font-medium hover:underline"
                    to={`/admin/parties/${guest.party_id}`}
                  >
                    {guest.party_name}
                  </Link>
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

      <GuestFormDialog
        guest={editingGuest}
        isPending={updateGuest.isPending}
        onOpenChange={setEditGuestOpen}
        onSubmit={handleGuestSubmit}
        open={editGuestOpen}
      />
    </div>
  );
}
