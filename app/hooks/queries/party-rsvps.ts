import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { QueryKey as DashboardQueryKey } from "@/hooks/queries/dashboard";
import { QueryKey as EventsQueryKey } from "@/hooks/queries/events";
import { QueryKey as PartiesQueryKey } from "@/hooks/queries/parties";
import { adminRequest, ApiError } from "@/libraries/admin-api";
import type {
  PartyRSVPsResponse,
  UpdatePartyRSVPsPayload,
} from "@/types/generated/rsvps";

/**
 * React Query hooks for the admin view of a party's whole RSVP (GET/PUT
 * /admin/parties/:id/rsvp): the same guests-by-event form the party itself
 * fills in, so the couple can record a response given to them directly (over
 * the phone, in person). Recording is not gated by the RSVP deadline.
 */

export const useAdminPartyRSVPs = (
  partyId?: string,
  options: Omit<
    UseQueryOptions<PartyRSVPsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<PartyRSVPsResponse, ApiError>({
    ...options,
    enabled: options.enabled ?? Boolean(partyId),
    queryKey: [PartiesQueryKey.RetrievePartyRSVPs, partyId],
    queryFn: () => adminRequest(`/admin/parties/${partyId}/rsvp`),
  });
};

// useRecordPartyRSVPs submits a party's whole RSVP on its behalf. The response
// is the refreshed view, written straight into the cache. A recording can
// change statuses (every event's breakdown and RSVP list, the guest list's
// RSVP filters, the dashboard's response rate) and guest rows (a placeholder's
// name, dietary restrictions), so it invalidates all of those.
export const useRecordPartyRSVPs = () => {
  const queryClient = useQueryClient();

  return useMutation<
    PartyRSVPsResponse,
    ApiError,
    { partyId: string; payload: UpdatePartyRSVPsPayload }
  >({
    mutationFn: ({ partyId, payload }) =>
      adminRequest(`/admin/parties/${partyId}/rsvp`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (data, variables) => {
      queryClient.setQueryData(
        [PartiesQueryKey.RetrievePartyRSVPs, variables.partyId],
        data,
      );
      queryClient.invalidateQueries({
        queryKey: [PartiesQueryKey.RetrieveParty, variables.partyId],
      });
      queryClient.invalidateQueries({
        queryKey: [PartiesQueryKey.ListParties],
      });
      queryClient.invalidateQueries({ queryKey: [PartiesQueryKey.ListGuests] });
      queryClient.invalidateQueries({ queryKey: [EventsQueryKey.ListEvents] });
      queryClient.invalidateQueries({
        queryKey: [EventsQueryKey.RetrieveEvent],
      });
      queryClient.invalidateQueries({
        queryKey: [EventsQueryKey.ListEventRSVPs],
      });
      queryClient.invalidateQueries({
        queryKey: [DashboardQueryKey.RetrieveDashboard],
      });
    },
  });
};
