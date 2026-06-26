import { keepPreviousData } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigationType } from "react-router-dom";
import { toast } from "sonner";

import { ChipsCombobox } from "@/components/library/ChipsCombobox";
import { GuestsGrid } from "@/components/pages/admin/grid/GuestsGrid";
import {
  BoolFilterSelect,
  FilterSelect,
} from "@/components/pages/admin/parties/FilterSelect";
import { FilterSheet } from "@/components/pages/admin/parties/FilterSheet";
import { GuestFormDialog } from "@/components/pages/admin/parties/GuestFormDialog";
import {
  BUILTIN_GUEST_SORT,
  CIRCLE_OPTIONS,
  GUEST_SORT_FIELD_SET,
  GUEST_SORT_FIELDS,
  GUEST_SORT_STORAGE_KEY,
  RELATION_OPTIONS,
  RSVP_STATUS_OPTIONS,
  SIDE_OPTIONS,
  type Option,
} from "@/components/pages/admin/parties/options";
import { SortSheet } from "@/components/pages/admin/parties/SortSheet";
import { Input } from "@/components/ui/input";
import { useEvents } from "@/hooks/queries/events";
import { useGuests, useUpdateGuest } from "@/hooks/queries/guests";
import { useParties } from "@/hooks/queries/parties";
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
  EventRSVPStatus,
  Relation,
  Side,
} from "@/types/generated/models";
import type {
  GuestListItem,
  ListGuestsQuery,
  PartyResponse,
  UpdateGuestPayload,
} from "@/types/generated/parties";

// Stable empty list so the parties prop keeps the same reference while the
// parties query is still loading (a fresh [] each render would needlessly
// recompute the grid's party lookups).
const EMPTY_PARTIES: PartyResponse[] = [];

// Boolean guest filters, listed so useFilterParams parses them back from the URL.
const BOOL_FILTERS = ["is_drinking", "is_child", "is_placeholder"] as const;

// Multi-value guest filters, listed so useFilterParams reads/writes them as
// repeated params (?tags=a&tags=b) and parses them back to a string[].
const ARRAY_FILTERS = ["tags"] as const;

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
  "event_id",
  "rsvp_status",
] as const;

// Every URL param forwarded to the list API: the sheet filters plus the search
// box and the sort (neither a filter, so both stay out of the badge count).
// Unknown params (a utm_ tag on a shared link) stay in the URL but never reach
// the API, whose binder 422s unknown query keys.
const QUERY_KEYS = [...FILTER_KEYS, "search", "sort"] as const;

/**
 * Admin flat guest list: every guest across all parties, edited like a
 * spreadsheet (each cell saves via PATCH on blur/Enter, with a tint confirming
 * the save). Filters cover the party plus the party-level attributes (side,
 * relation, circle), the guest-level ones (tag and the flags), and the guest's
 * Event RSVPs (pick an event to see its invited set, add an RSVP status to
 * narrow within it; status alone matches the status on any event), and live in
 * the URL so a filtered view can be shared and bookmarked. Guests are added
 * inline from the trailing row (which can also create a party); the full edit
 * dialog survives for dietary restrictions and table/seat.
 */
export default function AdminGuests() {
  useAdminPageTitle("Guests");
  const [filters, setFilter, clearAll] = useFilterParams<ListGuestsQuery>(
    QUERY_KEYS,
    BOOL_FILTERS,
    ARRAY_FILTERS,
  );
  const [editGuest, setEditGuest] = useState<GuestListItem | undefined>(
    undefined,
  );
  const [editOpen, setEditOpen] = useState(false);

  // Local search box state, debounced into the URL `search` param so a filtered
  // view stays shareable without firing a request on every keystroke.
  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  const navigationType = useNavigationType();
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
  // debounced effect above. Also restricted to non-REPLACE navigations: this
  // page's own writes (the debounce and the filter sheet) are all replaces, and
  // under a heavy render react-router can commit one hundreds of milliseconds
  // late, by which time the box may hold newer typing; copying the page's own
  // stale write back into the box would destroy that input, and the debounce's
  // input == URL guard would then never write it. External navigations are
  // POPs (back/forward) or PUSHes (a link), so they still resync.
  useEffect(() => {
    if (navigationType === "REPLACE") return;
    if (searchRef.current !== document.activeElement) {
      setSearchInput(filters.search ?? "");
    }
  }, [filters.search, navigationType]);

  const activeFilterCount = FILTER_KEYS.filter(
    (key) => filters[key] !== undefined,
  ).length;

  // Sort precedence: an explicit URL sort wins, else this browser's saved
  // default, else the builtin (creation order). The URL holds only a non-default
  // sort; the effective sort is always sent to the API so the server order is
  // explicit. See AdminParties for the shared shape.
  const [storedDefaultSort, saveStoredDefaultSort] = useSortDefault(
    GUEST_SORT_STORAGE_KEY,
    GUEST_SORT_FIELD_SET,
  );
  const urlSort = useMemo(
    () =>
      filters.sort ? parseSortSpec(filters.sort, GUEST_SORT_FIELD_SET) : null,
    [filters.sort],
  );
  const defaultSort =
    storedDefaultSort && storedDefaultSort.length > 0
      ? storedDefaultSort
      : BUILTIN_GUEST_SORT;
  const effectiveSort = urlSort && urlSort.length > 0 ? urlSort : defaultSort;
  const isSortDirty = urlSort !== null && !sortSpecsEqual(urlSort, defaultSort);

  const applySort = (next: SortLevel[]) => {
    const serialized = serializeSortSpec(next);
    setFilter(
      "sort",
      serialized && !sortSpecsEqual(next, defaultSort) ? serialized : undefined,
    );
  };
  const saveSortAsDefault = () => {
    saveStoredDefaultSort(effectiveSort);
    setFilter("sort", undefined);
  };
  const resetSort = () => setFilter("sort", undefined);

  // keepPreviousData holds the last results (and the count) on screen while a new
  // search/filter/sort fetches, so the list does not flash to a loading state on
  // every keystroke; the search box's spinner signals the refetch instead.
  const guestsQuery = useGuests(
    { ...filters, sort: serializeSortSpec(effectiveSort) || undefined },
    { placeholderData: keepPreviousData },
  );
  const guests = guestsQuery.data?.items ?? [];
  const updateGuest = useUpdateGuest();

  // Every party (the full response), for the Party filter, the editable Party
  // combobox, the add row's party picker, and the read-only party-attribute
  // columns the flat list surfaces (side, relation, circle, invitation, address,
  // rsvp, info status), all looked up by the guest's party.
  const partiesQuery = useParties({});
  const parties = partiesQuery.data?.items ?? EMPTY_PARTIES;
  // Parties as filter options (by id), for the Party filter at the top.
  const partyFilterOptions = useMemo<Option<string>[]>(
    () => parties.map((party) => ({ value: party.id, label: party.name })),
    [parties],
  );

  // Events as filter options (by id), for the Event filter: picking one narrows
  // the list to that event's invited guests; adding an RSVP status narrows it
  // within that event (status alone matches the status on any event).
  const eventsQuery = useEvents();
  const eventFilterOptions = useMemo<Option<string>[]>(
    () =>
      (eventsQuery.data?.items ?? []).map((event) => ({
        value: event.id,
        label: event.name,
      })),
    [eventsQuery.data],
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
  // The same distinct tags as bare strings, for the multi-select chips filter.
  const tagValues = useMemo(() => tagOptions.map((o) => o.value), [tagOptions]);

  const openEdit = (guest: GuestListItem) => {
    setEditGuest(guest);
    setEditOpen(true);
  };

  const handleEditSubmit = async (payload: UpdateGuestPayload) => {
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
          onClearAll={() => clearAll(["search", "sort"])}
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
          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Tags</span>
            <ChipsCombobox
              ariaLabel="Tags"
              onChange={(v) => setFilter("tags", v.length > 0 ? v : undefined)}
              options={tagValues}
              value={filters.tags ?? []}
            />
          </div>
          <FilterSelect<string>
            label="Event"
            onChange={(v) => setFilter("event_id", v)}
            options={eventFilterOptions}
            value={filters.event_id}
          />
          <FilterSelect<EventRSVPStatus>
            label="RSVP status"
            onChange={(v) => setFilter("rsvp_status", v)}
            options={RSVP_STATUS_OPTIONS}
            value={filters.rsvp_status as EventRSVPStatus | undefined}
          />
        </FilterSheet>
        <SortSheet
          fields={GUEST_SORT_FIELDS}
          isDirty={isSortDirty}
          levels={effectiveSort}
          onChange={applySort}
          onResetDefault={resetSort}
          onSaveDefault={saveSortAsDefault}
        />
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
              parties={parties}
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
