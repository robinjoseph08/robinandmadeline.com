import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { QueryKey as PartiesQueryKey } from "@/hooks/queries/parties";
import { QueryKey as TagsQueryKey } from "@/hooks/queries/tags";
import { adminRequest, ApiError } from "@/libraries/admin-api";
import type {
  CreateGuestPayload,
  GuestResponse,
  ListGuestsQuery,
  ListGuestsResponse,
  PartyResponse,
  PatchGuestPayload,
  UpdateGuestPayload,
} from "@/types/generated/parties";

/**
 * React Query hooks for the guests admin API. Guests are created nested under a
 * party (the party is part of their identity) but read/updated/deleted by their
 * own id. A guest write can change its party's derived info_collection_status
 * (the primary guest's email is a required field) and the single-primary set, so
 * every mutation invalidates the parent party detail and the parties list in
 * addition to the flat guest list.
 */

export enum QueryKey {
  ListGuests = "ListGuests",
}

export const useGuests = (
  query: ListGuestsQuery = {},
  options: Omit<
    UseQueryOptions<ListGuestsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListGuestsResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.ListGuests, query],
    queryFn: () => adminRequest("/admin/guests", { query }),
  });
};

// Invalidates everything a guest write can affect: the flat guest list, the
// parent party detail (guests + derived status + single-primary), the parties
// list (status column), and the tag vocabulary (a write can add or drop a tag,
// which the comboboxes and the tag filter offer).
function invalidateForGuestWrite(
  queryClient: ReturnType<typeof useQueryClient>,
  partyId: string,
) {
  queryClient.invalidateQueries({ queryKey: [QueryKey.ListGuests] });
  queryClient.invalidateQueries({
    queryKey: [PartiesQueryKey.RetrieveParty, partyId],
  });
  queryClient.invalidateQueries({ queryKey: [PartiesQueryKey.ListParties] });
  queryClient.invalidateQueries({ queryKey: [TagsQueryKey.ListTags] });
}

export const useCreateGuest = () => {
  const queryClient = useQueryClient();

  return useMutation<
    GuestResponse,
    ApiError,
    { partyId: string; payload: CreateGuestPayload }
  >({
    mutationFn: ({ partyId, payload }) =>
      adminRequest(`/admin/parties/${partyId}/guests`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (_data, variables) => {
      invalidateForGuestWrite(queryClient, variables.partyId);
    },
  });
};

// useUpdateGuest is the full-state update behind the edit dialog: PUT replaces
// every editable field (so omitted fields reset). The spreadsheet grid uses
// usePatchGuest instead, which sends only the changed field.
export const useUpdateGuest = () => {
  const queryClient = useQueryClient();

  return useMutation<
    GuestResponse,
    ApiError,
    { guestId: string; partyId: string; payload: UpdateGuestPayload }
  >({
    mutationFn: ({ guestId, payload }) =>
      adminRequest(`/admin/guests/${guestId}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (_data, variables) => {
      invalidateForGuestWrite(queryClient, variables.partyId);
    },
  });
};

// usePatchGuest is the partial update behind the spreadsheet grid: it sends only
// the fields the user changed (one cell, usually), via PATCH. partyId is carried
// only to scope cache invalidation; it is not part of the request. The response
// is written through to the cached guest rows before the invalidations, so
// anything that snapshots a row in the gap before the refetch (the edit dialog
// seeding its form) sees the patched values; the invalidations still run to
// reconcile derived fields (party status, party_name on a move).
export const usePatchGuest = () => {
  const queryClient = useQueryClient();

  return useMutation<
    GuestResponse,
    ApiError,
    { guestId: string; partyId: string; payload: PatchGuestPayload }
  >({
    mutationFn: ({ guestId, payload }) =>
      adminRequest(`/admin/guests/${guestId}`, {
        method: "PATCH",
        body: payload,
      }),
    onSuccess: (data, variables) => {
      // Merge over the cached item so list-only extras (party_name) survive.
      queryClient.setQueriesData<ListGuestsResponse>(
        { queryKey: [QueryKey.ListGuests] },
        (old) =>
          old === undefined
            ? undefined
            : {
                ...old,
                items: old.items.map((item) =>
                  item.id === data.id ? { ...item, ...data } : item,
                ),
              },
      );
      queryClient.setQueryData<PartyResponse>(
        [PartiesQueryKey.RetrieveParty, variables.partyId],
        (old) =>
          old === undefined
            ? undefined
            : {
                ...old,
                guests: old.guests?.map((guest) =>
                  guest.id === data.id ? { ...guest, ...data } : guest,
                ),
              },
      );
      invalidateForGuestWrite(queryClient, variables.partyId);
      // A party_id in the payload moved the guest between parties; the carried
      // partyId only covers the source, so refresh every party detail to pick
      // up the destination's new guest list too.
      if (variables.payload.party_id !== undefined) {
        queryClient.invalidateQueries({
          queryKey: [PartiesQueryKey.RetrieveParty],
        });
      }
    },
  });
};

export const useDeleteGuest = () => {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, { guestId: string; partyId: string }>({
    mutationFn: ({ guestId }) =>
      adminRequest(`/admin/guests/${guestId}`, { method: "DELETE" }),
    onSuccess: (_data, variables) => {
      invalidateForGuestWrite(queryClient, variables.partyId);
    },
  });
};
