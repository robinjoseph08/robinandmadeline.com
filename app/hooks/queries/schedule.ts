import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import { apiRequest } from "@/libraries/api";
import {
  ApiError,
  clearGuestToken,
  readGuestToken,
} from "@/libraries/guest-api";
import type { ListScheduleEventsResponse } from "@/types/generated/events";

/**
 * React Query hook for the guest-facing schedule (GET /api/events). The
 * endpoint personalizes by an optional guest token: anonymous requests get
 * public events only, a valid token adds the party's invited private events.
 * The fetch attaches the persisted guest token when one exists; a 401 on that
 * authenticated attempt means the stored token is stale, so it is cleared and
 * the fetch retries anonymously rather than failing the page.
 */

export enum QueryKey {
  ScheduleEvents = "ScheduleEvents",
}

/** The schedule plus whether the personalized (guest-token) view was served. */
export interface ScheduleView {
  schedule: ListScheduleEventsResponse;
  authenticated: boolean;
}

async function fetchSchedule(): Promise<ScheduleView> {
  const token = readGuestToken();
  if (token === null) {
    return {
      schedule: await apiRequest<ListScheduleEventsResponse>("/events"),
      authenticated: false,
    };
  }
  try {
    return {
      schedule: await apiRequest<ListScheduleEventsResponse>("/events", {
        token,
      }),
      authenticated: true,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      clearGuestToken();
      return {
        schedule: await apiRequest<ListScheduleEventsResponse>("/events"),
        authenticated: false,
      };
    }
    throw err;
  }
}

export const useScheduleEvents = (
  options: Omit<
    UseQueryOptions<ScheduleView, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ScheduleView, ApiError>({
    ...options,
    queryKey: [QueryKey.ScheduleEvents],
    queryFn: fetchSchedule,
  });
};
