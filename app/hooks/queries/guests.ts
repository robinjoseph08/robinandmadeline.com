import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { QueryKey as PartiesQueryKey } from "@/hooks/queries/parties";
import { adminRequest, ApiError } from "@/libraries/admin-api";
import type {
  CreateGuestPayload,
  GuestResponse,
  ListGuestsQuery,
  ListGuestsResponse,
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
// parent party detail (guests + derived status + single-primary), and the
// parties list (status column).
function invalidateForGuestWrite(
  queryClient: ReturnType<typeof useQueryClient>,
  partyId: string,
) {
  queryClient.invalidateQueries({ queryKey: [QueryKey.ListGuests] });
  queryClient.invalidateQueries({
    queryKey: [PartiesQueryKey.RetrieveParty, partyId],
  });
  queryClient.invalidateQueries({ queryKey: [PartiesQueryKey.ListParties] });
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

export const useUpdateGuest = () => {
  const queryClient = useQueryClient();

  return useMutation<
    GuestResponse,
    ApiError,
    { guestId: string; partyId: string; payload: UpdateGuestPayload }
  >({
    mutationFn: ({ guestId, payload }) =>
      adminRequest(`/admin/guests/${guestId}`, {
        method: "PATCH",
        body: payload,
      }),
    onSuccess: (_data, variables) => {
      invalidateForGuestWrite(queryClient, variables.partyId);
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
