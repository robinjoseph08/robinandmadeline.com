import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiRequest } from "@/libraries/api";
import type {
  SubscriptionResponse,
  UpdateSubscriptionPayload,
} from "@/types/generated/subscriptions";

/**
 * React Query hooks for the guest-facing email subscription API. There is no
 * JWT: the guest's own UUID from the /u/:guestId URL is the authentication (ADR
 * 0009), so the fetches go through the bare `apiRequest`. The surface is a
 * single resource (one guest's subscription), so there is one query key per
 * guest id and the POST response replaces the cached view.
 */

export enum QueryKey {
  Subscription = "Subscription",
}

/** The API path for a guest id, safely encoded into the URL. */
function subscriptionPath(guestId: string): string {
  return `/subscriptions/${encodeURIComponent(guestId)}`;
}

export const useSubscription = (guestId: string) => {
  return useQuery<SubscriptionResponse, ApiError>({
    queryKey: [QueryKey.Subscription, guestId],
    queryFn: () => apiRequest(subscriptionPath(guestId)),
    // A stale, mistyped, or revoked link is a 404; there is nothing to retry.
    retry: false,
  });
};

// useSetSubscription flips the guest's subscription from the page button (false
// to unsubscribe, true to resubscribe). The backend returns the refreshed view,
// which replaces the cached query so the page re-renders without a refetch.
export const useSetSubscription = (guestId: string) => {
  const queryClient = useQueryClient();

  return useMutation<SubscriptionResponse, ApiError, boolean>({
    mutationFn: (subscribed) =>
      apiRequest(subscriptionPath(guestId), {
        method: "POST",
        body: { subscribed } satisfies UpdateSubscriptionPayload,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData([QueryKey.Subscription, guestId], data);
    },
  });
};
