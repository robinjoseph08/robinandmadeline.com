import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { adminRequest, ApiError } from "@/libraries/admin-api";
import type {
  CreatePartyWithGuestPayload,
  ListPartiesQuery,
  ListPartiesResponse,
  MarkInfoPayload,
  PartyResponse,
  PatchPartyPayload,
  UpdatePartyPayload,
} from "@/types/generated/parties";

/**
 * React Query hooks for the parties admin API. Every fetch goes through
 * `adminRequest` (which carries the admin token); the hooks are typed end to end
 * with the tygo-generated request/response types. Mutations invalidate the
 * affected list and detail keys so the table and detail page stay fresh,
 * including after a status transition (request-info / mark-info) that changes the
 * derived info_collection_status.
 */

export enum QueryKey {
  ListParties = "ListParties",
  RetrieveParty = "RetrieveParty",
  // Guest reads join through the party (side/relation/circle filters), so a party
  // write can change the flat guest list; mutations here invalidate it too.
  ListGuests = "ListGuests",
}

export const useParties = (
  query: ListPartiesQuery = {},
  options: Omit<
    UseQueryOptions<ListPartiesResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListPartiesResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.ListParties, query],
    queryFn: () => adminRequest("/admin/parties", { query }),
  });
};

export const useParty = (
  partyId?: string,
  options: Omit<
    UseQueryOptions<PartyResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<PartyResponse, ApiError>({
    ...options,
    // Default to "only fetch once we have an id", but let a caller override.
    // Spread first so an explicit options.enabled wins and an omitted one falls
    // back to this rather than clobbering it with undefined.
    enabled: options.enabled ?? Boolean(partyId),
    queryKey: [QueryKey.RetrieveParty, partyId],
    queryFn: () => adminRequest(`/admin/parties/${partyId}`),
  });
};

// useCreatePartyWithGuest backs the only way to create a party: a party is born
// together with its first (primary) guest via POST /parties, so it can never be
// empty. It affects both lists, so it invalidates the parties list and the flat
// guest list.
export const useCreatePartyWithGuest = () => {
  const queryClient = useQueryClient();

  return useMutation<PartyResponse, ApiError, CreatePartyWithGuestPayload>({
    mutationFn: (payload) =>
      adminRequest("/admin/parties", { method: "POST", body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListParties] });
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListGuests] });
    },
  });
};

export const useUpdateParty = () => {
  const queryClient = useQueryClient();

  return useMutation<
    PartyResponse,
    ApiError,
    { partyId: string; payload: UpdatePartyPayload }
  >({
    mutationFn: ({ partyId, payload }) =>
      adminRequest(`/admin/parties/${partyId}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.RetrieveParty, variables.partyId],
      });
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListParties] });
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListGuests] });
    },
  });
};

// usePatchParty is the partial update behind the spreadsheet grid: it sends only
// the fields the user changed (one cell, usually), via PATCH. The full-state
// useUpdateParty (PUT) still backs the edit dialog. Both invalidate the same
// keys, since a field edit can change the derived status shown in the lists.
export const usePatchParty = () => {
  const queryClient = useQueryClient();

  return useMutation<
    PartyResponse,
    ApiError,
    { partyId: string; payload: PatchPartyPayload }
  >({
    mutationFn: ({ partyId, payload }) =>
      adminRequest(`/admin/parties/${partyId}`, {
        method: "PATCH",
        body: payload,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.RetrieveParty, variables.partyId],
      });
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListParties] });
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListGuests] });
    },
  });
};

export const useDeleteParty = () => {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, { partyId: string }>({
    mutationFn: ({ partyId }) =>
      adminRequest(`/admin/parties/${partyId}`, { method: "DELETE" }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListParties] });
      queryClient.removeQueries({
        queryKey: [QueryKey.RetrieveParty, variables.partyId],
      });
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListGuests] });
    },
  });
};

export const useRequestInfo = () => {
  const queryClient = useQueryClient();

  return useMutation<PartyResponse, ApiError, { partyId: string }>({
    mutationFn: ({ partyId }) =>
      adminRequest(`/admin/parties/${partyId}/request-info`, {
        method: "POST",
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.RetrieveParty, variables.partyId],
      });
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListParties] });
    },
  });
};

export const useMarkInfo = () => {
  const queryClient = useQueryClient();

  return useMutation<
    PartyResponse,
    ApiError,
    { partyId: string; payload: MarkInfoPayload }
  >({
    mutationFn: ({ partyId, payload }) =>
      adminRequest(`/admin/parties/${partyId}/mark-info`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.RetrieveParty, variables.partyId],
      });
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListParties] });
    },
  });
};
