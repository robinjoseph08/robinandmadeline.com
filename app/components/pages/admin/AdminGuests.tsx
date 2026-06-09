import { keepPreviousData } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { GuestsGrid } from "@/components/pages/admin/grid/GuestsGrid";
import {
  BoolFilterSelect,
  FilterSelect,
} from "@/components/pages/admin/parties/FilterSelect";
import { FilterSheet } from "@/components/pages/admin/parties/FilterSheet";
import { GuestFormDialog } from "@/components/pages/admin/parties/GuestFormDialog";
import {
  CIRCLE_OPTIONS,
  RELATION_OPTIONS,
  SIDE_OPTIONS,
  type Option,
} from "@/components/pages/admin/parties/options";
import { Input } from "@/components/ui/input";
import { useGuests, useUpdateGuest } from "@/hooks/queries/guests";
import { useParties } from "@/hooks/queries/parties";
import { useFilterParams } from "@/hooks/useFilterParams";
import type { Circle, Relation, Side } from "@/types/generated/models";
import type {
  CreateGuestPayload,
  GuestListItem,
  ListGuestsQuery,
} from "@/types/generated/parties";

// Boolean guest filters, listed so useFilterParams parses them back from the URL.
const BOOL_FILTERS = ["is_drinking", "is_child", "is_placeholder"] as const;

// Filter keys (everything but the search box), counted for the "Filters" badge.
const FILTER_KEYS = [
  "party_id",
  "side",
  "relation",
  "circle",
  "is_drinking",
  "is_child",
  "is_placeholder",
  "tags",
] as const;

/**
 * Admin flat guest list: every guest across all parties, edited like a
 * spreadsheet (each cell saves via PATCH on blur/Enter, with a tint confirming
 * the save). Filters cover the party plus the party-level attributes (side,
 * relation, circle) and the guest-level ones (tag and the flags), and live in the
 * URL so a filtered view can be shared and bookmarked. Guests are added inline
 * from the trailing row (which can also create a party); the full edit dialog
 * survives for dietary restrictions and table/seat.
 */
export default function AdminGuests() {
  const [filters, setFilter, clearAll] =
    useFilterParams<ListGuestsQuery>(BOOL_FILTERS);
  const [editGuest, setEditGuest] = useState<GuestListItem | undefined>(
    undefined,
  );
  const [editOpen, setEditOpen] = useState(false);

  // Local search box state, debounced into the URL `search` param so a filtered
  // view stays shareable without firing a request on every keystroke.
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handle = setTimeout(() => {
      const next = searchInput.trim() || undefined;
      if (next !== filters.search) setFilter("search", next);
    }, 300);
    return () => clearTimeout(handle);
  }, [searchInput, filters.search, setFilter]);
  // Resync the box when `search` changes in the URL from outside it (back/forward
  // navigation, or a shared link loaded into the mounted page). Guarded on focus
  // so it never clobbers what the user is actively typing; that direction is the
  // debounced effect above.
  useEffect(() => {
    if (searchRef.current !== document.activeElement) {
      setSearchInput(filters.search ?? "");
    }
  }, [filters.search]);

  const activeFilterCount = FILTER_KEYS.filter(
    (key) => filters[key] !== undefined,
  ).length;

  // keepPreviousData holds the last results (and the count) on screen while a new
  // search/filter fetches, so the list does not flash to a loading state on every
  // keystroke; the search box's spinner signals the refetch instead.
  const guestsQuery = useGuests(filters, { placeholderData: keepPreviousData });
  const guests = guestsQuery.data?.items ?? [];
  const updateGuest = useUpdateGuest();

  // Every party, for the Party filter, the editable Party combobox, the add row's
  // party picker, and the read-only Side/Relation columns (looked up by party).
  const partiesQuery = useParties({});
  const partyOptions = useMemo(
    () =>
      (partiesQuery.data?.items ?? []).map((party) => ({
        id: party.id,
        name: party.name,
        side: party.side,
        relation: party.relation,
      })),
    [partiesQuery.data],
  );
  // Parties as filter options (by id), for the Party filter at the top.
  const partyFilterOptions = useMemo<Option<string>[]>(
    () => partyOptions.map((party) => ({ value: party.id, label: party.name })),
    [partyOptions],
  );

  // Distinct tags across all guests, offered as the tag filter's options. The
  // parties query already loads each party's guests, so this needs no extra
  // fetch; tags are open-ended, so the option set is whatever is currently used.
  const tagOptions = useMemo<Option<string>[]>(() => {
    const seen = new Set<string>();
    const opts: Option<string>[] = [];
    for (const party of partiesQuery.data?.items ?? []) {
      for (const guest of party.guests ?? []) {
        for (const tag of guest.tags) {
          const key = tag.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            opts.push({ value: tag, label: tag });
          }
        }
      }
    }
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [partiesQuery.data]);

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

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-xs">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            {guestsQuery.isFetching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Search className="size-4" />
            )}
          </span>
          <Input
            aria-label="Search guests"
            className="pl-8"
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, email, phone, party..."
            ref={searchRef}
            value={searchInput}
          />
        </div>
        <FilterSheet
          activeCount={activeFilterCount}
          onClearAll={() => clearAll(["search"])}
        >
          <FilterSelect<string>
            label="Party"
            onChange={(v) => setFilter("party_id", v)}
            options={partyFilterOptions}
            value={filters.party_id}
          />
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
          <FilterSelect<string>
            label="Tag"
            onChange={(v) => setFilter("tags", v)}
            options={tagOptions}
            value={filters.tags}
          />
        </FilterSheet>
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
