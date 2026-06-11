import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { QueryKey as PartiesQueryKey } from "@/hooks/queries/parties";
import { adminRequest, ApiError } from "@/libraries/admin-api";
import type {
  CreateEventPayload,
  EventResponse,
  EventRSVPListItem,
  InvitePartiesPayload,
  ListEventRSVPsResponse,
  ListEventsResponse,
  UpdateEventPayload,
  UpdateEventRSVPPayload,
} from "@/types/generated/events";

/**
 * React Query hooks for the events admin API. Every fetch goes through
 * `adminRequest` (which carries the admin token); the hooks are typed end to
 * end with the tygo-generated request/response types. An Event RSVP row is the
 * invitation (ADR 0002), so event writes can change RSVP rows (a public event
 * backfills every guest) and guest writes can change events' breakdowns;
 * mutations here invalidate the affected event list/detail/RSVP keys, and the
 * guest list too where a write affects which guests match the event filters.
 */

export enum QueryKey {
  ListEvents = "ListEvents",
  RetrieveEvent = "RetrieveEvent",
  ListEventRSVPs = "ListEventRSVPs",
  // The flat guest list can be filtered by event/RSVP status, so writes that
  // create or change Event RSVP rows invalidate it as well.
  ListGuests = "ListGuests",
}

export const useEvents = (
  options: Omit<
    UseQueryOptions<ListEventsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListEventsResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.ListEvents],
    queryFn: () => adminRequest("/admin/events"),
  });
};

export const useEvent = (
  eventId?: string,
  options: Omit<
    UseQueryOptions<EventResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<EventResponse, ApiError>({
    ...options,
    // Default to "only fetch once we have an id", but let a caller override.
    enabled: options.enabled ?? Boolean(eventId),
    queryKey: [QueryKey.RetrieveEvent, eventId],
    queryFn: () => adminRequest(`/admin/events/${eventId}`),
  });
};

export const useEventRSVPs = (
  eventId?: string,
  options: Omit<
    UseQueryOptions<ListEventRSVPsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListEventRSVPsResponse, ApiError>({
    ...options,
    enabled: options.enabled ?? Boolean(eventId),
    queryKey: [QueryKey.ListEventRSVPs, eventId],
    queryFn: () => adminRequest(`/admin/events/${eventId}/rsvps`),
  });
};

// Invalidates everything an event write can affect: the events list (order,
// breakdowns), the event detail, its RSVP list, and the flat guest list (whose
// event/RSVP filters read the same rows).
function invalidateForEventWrite(
  queryClient: ReturnType<typeof useQueryClient>,
  eventId?: string,
) {
  queryClient.invalidateQueries({ queryKey: [QueryKey.ListEvents] });
  if (eventId !== undefined) {
    queryClient.invalidateQueries({
      queryKey: [QueryKey.RetrieveEvent, eventId],
    });
    queryClient.invalidateQueries({
      queryKey: [QueryKey.ListEventRSVPs, eventId],
    });
  }
  queryClient.invalidateQueries({ queryKey: [QueryKey.ListGuests] });
}

export const useCreateEvent = () => {
  const queryClient = useQueryClient();

  return useMutation<EventResponse, ApiError, CreateEventPayload>({
    mutationFn: (payload) =>
      adminRequest("/admin/events", { method: "POST", body: payload }),
    onSuccess: (data) => {
      invalidateForEventWrite(queryClient, data.id);
    },
  });
};

export const useUpdateEvent = () => {
  const queryClient = useQueryClient();

  return useMutation<
    EventResponse,
    ApiError,
    { eventId: string; payload: UpdateEventPayload }
  >({
    mutationFn: ({ eventId, payload }) =>
      adminRequest(`/admin/events/${eventId}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (_data, variables) => {
      invalidateForEventWrite(queryClient, variables.eventId);
    },
  });
};

export const useDeleteEvent = () => {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, { eventId: string }>({
    mutationFn: ({ eventId }) =>
      adminRequest(`/admin/events/${eventId}`, { method: "DELETE" }),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListEvents] });
      queryClient.removeQueries({
        queryKey: [QueryKey.RetrieveEvent, variables.eventId],
      });
      queryClient.removeQueries({
        queryKey: [QueryKey.ListEventRSVPs, variables.eventId],
      });
      queryClient.invalidateQueries({ queryKey: [QueryKey.ListGuests] });
    },
  });
};

// useInviteParties bulk-invites parties to a private event (pending Event RSVP
// rows for all their guests). The response is the event with its refreshed
// breakdown; the invalidations refresh the RSVP list and the lists whose
// counts changed.
export const useInviteParties = () => {
  const queryClient = useQueryClient();

  return useMutation<
    EventResponse,
    ApiError,
    { eventId: string; payload: InvitePartiesPayload }
  >({
    mutationFn: ({ eventId, payload }) =>
      adminRequest(`/admin/events/${eventId}/invite`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: (_data, variables) => {
      invalidateForEventWrite(queryClient, variables.eventId);
    },
  });
};

// useUpdateEventRSVP is the admin override for one guest's response to one
// event (a phone or in-person answer). It also refreshes the parties list and
// detail: overall attendance ("coming" anywhere) is derived from these rows.
export const useUpdateEventRSVP = () => {
  const queryClient = useQueryClient();

  return useMutation<
    EventRSVPListItem,
    ApiError,
    { eventId: string; guestId: string; payload: UpdateEventRSVPPayload }
  >({
    mutationFn: ({ eventId, guestId, payload }) =>
      adminRequest(`/admin/events/${eventId}/rsvps/${guestId}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: (_data, variables) => {
      invalidateForEventWrite(queryClient, variables.eventId);
      queryClient.invalidateQueries({
        queryKey: [PartiesQueryKey.ListParties],
      });
    },
  });
};
