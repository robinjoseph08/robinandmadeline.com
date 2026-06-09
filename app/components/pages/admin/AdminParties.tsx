import { useState } from "react";
import { toast } from "sonner";

import { PartiesGrid } from "@/components/pages/admin/grid/PartiesGrid";
import {
  BoolFilterSelect,
  FilterSelect,
} from "@/components/pages/admin/parties/FilterSelect";
import { FilterSheet } from "@/components/pages/admin/parties/FilterSheet";
import {
  CIRCLE_OPTIONS,
  INFO_STATUS_OPTIONS,
  INVITATION_TYPE_OPTIONS,
  RELATION_OPTIONS,
  SIDE_OPTIONS,
} from "@/components/pages/admin/parties/options";
import { PartyFormDialog } from "@/components/pages/admin/parties/PartyFormDialog";
import { useParties, useUpdateParty } from "@/hooks/queries/parties";
import { useFilterParams } from "@/hooks/useFilterParams";
import type {
  Circle,
  InfoCollectionStatus,
  InvitationType,
  Relation,
  Side,
} from "@/types/generated/models";
import type {
  CreatePartyPayload,
  ListPartiesQuery,
  PartyResponse,
} from "@/types/generated/parties";

// Boolean party filters, listed so useFilterParams parses them back from the URL.
const BOOL_FILTERS = ["info_collection_requested"] as const;

// Filter keys, counted for the "Filters" badge.
const FILTER_KEYS = [
  "side",
  "relation",
  "circle",
  "invitation_type",
  "info_collection_status",
  "info_collection_requested",
] as const;

/**
 * Admin parties list, edited like a spreadsheet: every cell saves on the spot via
 * PATCH (a tint confirms the save). Parties are created from the guest list, so
 * there is no add row here. Filters sit above the grid and live in the URL so a
 * filtered view can be shared and bookmarked; the derived info-collection status
 * and per-row copy buttons (the info link still triggers request-info) are
 * unchanged. The full edit dialog survives for the mailing address.
 */
export default function AdminParties() {
  const [filters, setFilter, clearAll] =
    useFilterParams<ListPartiesQuery>(BOOL_FILTERS);
  const [editParty, setEditParty] = useState<PartyResponse | undefined>(
    undefined,
  );
  const [editOpen, setEditOpen] = useState(false);

  const partiesQuery = useParties(filters);
  const updateParty = useUpdateParty();

  const parties = partiesQuery.data?.items ?? [];

  const activeFilterCount = FILTER_KEYS.filter(
    (key) => filters[key] !== undefined,
  ).length;

  const openEdit = (party: PartyResponse) => {
    setEditParty(party);
    setEditOpen(true);
  };

  const handleEditSubmit = async (payload: CreatePartyPayload) => {
    if (!editParty) return;
    try {
      await updateParty.mutateAsync({ partyId: editParty.id, payload });
      toast.success("Party updated");
      setEditOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update party",
      );
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Parties</h1>
        <p className="text-sm text-muted-foreground">
          {partiesQuery.data
            ? `${partiesQuery.data.total} part${partiesQuery.data.total === 1 ? "y" : "ies"}`
            : "Edit inline; parties are created from the guest list."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <FilterSheet
          activeCount={activeFilterCount}
          onClearAll={() => clearAll()}
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
          <FilterSelect<InvitationType>
            label="Invitation"
            onChange={(v) => setFilter("invitation_type", v)}
            options={INVITATION_TYPE_OPTIONS}
            value={filters.invitation_type as InvitationType | undefined}
          />
          <FilterSelect<InfoCollectionStatus>
            label="Info status"
            onChange={(v) => setFilter("info_collection_status", v)}
            options={INFO_STATUS_OPTIONS}
            value={filters.info_collection_status}
          />
          <BoolFilterSelect
            label="Info requested"
            onChange={(v) => setFilter("info_collection_requested", v)}
            value={filters.info_collection_requested}
          />
        </FilterSheet>
      </div>

      {partiesQuery.isLoading ? (
        <p className="text-muted-foreground">Loading parties...</p>
      ) : partiesQuery.isError ? (
        <p className="text-destructive">{partiesQuery.error.message}</p>
      ) : (
        // The grid always renders so its add row stays available; a hint above it
        // explains an empty result rather than leaving a lone, muted add row.
        <div className="space-y-2">
          {parties.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No parties match these filters. Parties are created by adding a
              guest from the Guests page.
            </p>
          ) : null}
          <div className="rounded-md border border-ink/10">
            <PartiesGrid onEditParty={openEdit} parties={parties} />
          </div>
        </div>
      )}

      <PartyFormDialog
        isPending={updateParty.isPending}
        onOpenChange={setEditOpen}
        onSubmit={handleEditSubmit}
        open={editOpen}
        party={editParty}
      />
    </div>
  );
}
