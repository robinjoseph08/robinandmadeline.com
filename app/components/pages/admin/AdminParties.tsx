import { keepPreviousData } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { PartiesGrid } from "@/components/pages/admin/grid/PartiesGrid";
import {
  BoolFilterSelect,
  FilterSelect,
} from "@/components/pages/admin/parties/FilterSelect";
import { FilterSheet } from "@/components/pages/admin/parties/FilterSheet";
import {
  BUILTIN_PARTY_SORT,
  CIRCLE_OPTIONS,
  INFO_STATUS_OPTIONS,
  INVITATION_TYPE_OPTIONS,
  PARTY_SORT_FIELD_SET,
  PARTY_SORT_FIELDS,
  PARTY_SORT_STORAGE_KEY,
  RELATION_OPTIONS,
  SIDE_OPTIONS,
} from "@/components/pages/admin/parties/options";
import { PartyFormDialog } from "@/components/pages/admin/parties/PartyFormDialog";
import { SortSheet } from "@/components/pages/admin/parties/SortSheet";
import { useParties, useUpdateParty } from "@/hooks/queries/parties";
import { useFilterParams } from "@/hooks/useFilterParams";
import { useAdminPageTitle } from "@/hooks/usePageTitle";
import { useSortDefault } from "@/hooks/useSortDefault";
import {
  parseSortSpec,
  serializeSortSpec,
  sortSpecsEqual,
  type SortLevel,
} from "@/libraries/sortSpec";
import type {
  Circle,
  InfoCollectionStatus,
  InvitationType,
  Relation,
  Side,
} from "@/types/generated/models";
import type {
  ListPartiesQuery,
  PartyResponse,
  UpdatePartyPayload,
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

// Every URL param forwarded to the list API: the filters plus the sort (which is
// not a filter, so it stays out of the badge count). Unknown params (a utm_ tag
// on a shared link) stay in the URL but never reach the API, whose binder 422s
// unknown query keys.
const QUERY_KEYS = [...FILTER_KEYS, "sort"] as const;

/**
 * Admin parties list, edited like a spreadsheet: every cell saves on the spot via
 * PATCH (a tint confirms the save). Parties are created from the guest list, so
 * there is no add row here. Filters sit above the grid and live in the URL so a
 * filtered view can be shared and bookmarked; the derived info-collection status
 * and per-row copy buttons (the info link still triggers request-info) are
 * unchanged. The full edit dialog survives for the mailing address.
 */
export default function AdminParties() {
  useAdminPageTitle("Parties");
  const [filters, setFilter, clearAll] = useFilterParams<ListPartiesQuery>(
    QUERY_KEYS,
    BOOL_FILTERS,
  );
  const [editParty, setEditParty] = useState<PartyResponse | undefined>(
    undefined,
  );
  const [editOpen, setEditOpen] = useState(false);

  // Sort precedence: an explicit URL sort wins, else this browser's saved
  // default, else the builtin (creation order). The URL holds only a non-default
  // sort (kept shareable via the same useFilterParams writer as the filters); the
  // effective sort is always sent to the API so the server order is explicit.
  const [storedDefaultSort, saveStoredDefaultSort] = useSortDefault(
    PARTY_SORT_STORAGE_KEY,
    PARTY_SORT_FIELD_SET,
  );
  const urlSort = useMemo(
    () =>
      filters.sort ? parseSortSpec(filters.sort, PARTY_SORT_FIELD_SET) : null,
    [filters.sort],
  );
  const defaultSort =
    storedDefaultSort && storedDefaultSort.length > 0
      ? storedDefaultSort
      : BUILTIN_PARTY_SORT;
  const effectiveSort = urlSort && urlSort.length > 0 ? urlSort : defaultSort;
  const isSortDirty = urlSort !== null && !sortSpecsEqual(urlSort, defaultSort);

  // Write the sort to the URL, but only when it differs from the default (a
  // default sort leaves the URL clean and falls through to the same effective
  // order).
  const applySort = (next: SortLevel[]) => {
    const serialized = serializeSortSpec(next);
    setFilter(
      "sort",
      serialized && !sortSpecsEqual(next, defaultSort) ? serialized : undefined,
    );
  };
  const saveSortAsDefault = () => {
    saveStoredDefaultSort(effectiveSort);
    setFilter("sort", undefined); // now the default; clear the URL override
  };
  const resetSort = () => setFilter("sort", undefined);

  // keepPreviousData keeps the current rows on screen while a filter or sort
  // change refetches, instead of flashing the "Loading parties..." state.
  const partiesQuery = useParties(
    { ...filters, sort: serializeSortSpec(effectiveSort) || undefined },
    { placeholderData: keepPreviousData },
  );
  const updateParty = useUpdateParty();

  const parties = partiesQuery.data?.items ?? [];

  const activeFilterCount = FILTER_KEYS.filter(
    (key) => filters[key] !== undefined,
  ).length;

  const openEdit = (party: PartyResponse) => {
    setEditParty(party);
    setEditOpen(true);
  };

  const handleEditSubmit = async (payload: UpdatePartyPayload) => {
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
          onClearAll={() => clearAll(["sort"])}
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
        <SortSheet
          fields={PARTY_SORT_FIELDS}
          isDirty={isSortDirty}
          levels={effectiveSort}
          onChange={applySort}
          onResetDefault={resetSort}
          onSaveDefault={saveSortAsDefault}
        />
      </div>

      {partiesQuery.isLoading ? (
        <p className="text-muted-foreground">Loading parties...</p>
      ) : partiesQuery.isError ? (
        <p className="text-destructive">{partiesQuery.error.message}</p>
      ) : (
        // The grid always renders (there is no add row here; parties are born
        // from the guest list) so the header keeps the layout stable on an
        // empty result, which the hint above it explains.
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
