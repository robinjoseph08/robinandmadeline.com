import { useMemo, useState } from "react";
import { toast } from "sonner";

import { GuestsGrid } from "@/components/pages/admin/grid/GuestsGrid";
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
import { Input } from "@/components/ui/input";
import { useGuests, useUpdateGuest } from "@/hooks/queries/guests";
import { useParties } from "@/hooks/queries/parties";
import type { Circle, Relation, Side } from "@/types/generated/models";
import type {
  CreateGuestPayload,
  GuestListItem,
  ListGuestsQuery,
} from "@/types/generated/parties";

/**
 * Admin flat guest list: every guest across all parties, edited like a
 * spreadsheet (each cell saves via PATCH on blur/Enter). Filters cover the
 * party-level attributes (side, relation, circle) and the guest-level ones (tag
 * contains, plus the flags). The Party column links each guest to its owning
 * party; the full edit dialog survives for dietary restrictions and table/seat.
 * There is no add row here (a guest needs a party, so guests are added from a
 * party's detail page).
 */
export default function AdminGuests() {
  const [filters, setFilters] = useState<ListGuestsQuery>({});
  // Local text state for the "tag contains" filter, committed to the query.
  const [tagsInput, setTagsInput] = useState("");
  const [editGuest, setEditGuest] = useState<GuestListItem | undefined>(
    undefined,
  );
  const [editOpen, setEditOpen] = useState(false);

  const guestsQuery = useGuests(filters);
  const guests = guestsQuery.data?.items ?? [];
  const updateGuest = useUpdateGuest();

  // Every party, for the editable Party combobox and the add row's party picker.
  const partiesQuery = useParties({});
  const partyOptions = useMemo(
    () =>
      (partiesQuery.data?.items ?? []).map((party) => ({
        id: party.id,
        name: party.name,
      })),
    [partiesQuery.data],
  );

  const setFilter = <K extends keyof ListGuestsQuery>(
    key: K,
    value: ListGuestsQuery[K],
  ) => setFilters((prev) => ({ ...prev, [key]: value }));

  const commitTags = () => {
    const trimmed = tagsInput.trim();
    setFilter("tags", trimmed === "" ? undefined : trimmed);
  };

  const openEdit = (guest: GuestListItem) => {
    setEditGuest(guest);
    setEditOpen(true);
  };

  const handleEditSubmit = async (payload: CreateGuestPayload) => {
    if (!editGuest) return;
    try {
      await updateGuest.mutateAsync({
        guestId: editGuest.id,
        partyId: editGuest.party_id,
        payload,
      });
      toast.success("Guest updated");
      setEditOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update guest",
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

      <div
        aria-label="Filters"
        className="flex flex-wrap items-end gap-4"
        role="group"
      >
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
          <span className="font-medium">Tag contains</span>
          <Input
            className="w-40"
            onBlur={commitTags}
            onChange={(e) => setTagsInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitTags();
            }}
            placeholder="e.g. Bridal Party"
            value={tagsInput}
          />
        </label>
      </div>

      {guestsQuery.isLoading ? (
        <p className="text-muted-foreground">Loading guests...</p>
      ) : guestsQuery.isError ? (
        <p className="text-destructive">{guestsQuery.error.message}</p>
      ) : (
        // The grid always renders so its add row stays available; a hint above it
        // explains an empty result.
        <div className="space-y-2">
          {guests.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No guests match these filters. Add one in the row below.
            </p>
          ) : null}
          <div className="rounded-md border border-ink/10">
            <GuestsGrid<GuestListItem>
              guests={guests}
              onEditGuest={openEdit}
              parties={partyOptions}
              partyIdFor={(guest) => guest.party_id}
            />
          </div>
        </div>
      )}

      <GuestFormDialog
        guest={editGuest}
        isPending={updateGuest.isPending}
        onOpenChange={setEditOpen}
        onSubmit={handleEditSubmit}
        open={editOpen}
      />
    </div>
  );
}
