import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { ApiError, guestRequest } from "@/libraries/guest-api";
import type {
  PartyRSVPsResponse,
  UpdatePartyRSVPsPayload,
} from "@/types/generated/rsvps";

/**
 * React Query hooks for the guest RSVP API. Every fetch goes through
 * `guestRequest` (which carries the persisted guest token); the hooks are
 * typed end to end with the tygo-generated request/response types. The guest
 * surface is a single resource (the authenticated party's RSVPs), so there is
 * one query key and the PUT response simply replaces the cached view.
 */

export enum QueryKey {
  PartyRSVPs = "PartyRSVPs",
}

export const usePartyRSVPs = (
  options: Omit<
    UseQueryOptions<PartyRSVPsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<PartyRSVPsResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.PartyRSVPs],
    queryFn: () => guestRequest("/guest/rsvp"),
  });
};

// useUpdatePartyRSVPs submits the whole RSVP form at once. The backend
// responds with the refreshed view, which replaces the cached query data so
// the confirmation page renders the submitted state without a refetch.
export const useUpdatePartyRSVPs = () => {
  const queryClient = useQueryClient();

  return useMutation<PartyRSVPsResponse, ApiError, UpdatePartyRSVPsPayload>({
    mutationFn: (payload) =>
      guestRequest("/guest/rsvp", { method: "PUT", body: payload }),
    onSuccess: (data) => {
      queryClient.setQueryData([QueryKey.PartyRSVPs], data);
    },
  });
};
