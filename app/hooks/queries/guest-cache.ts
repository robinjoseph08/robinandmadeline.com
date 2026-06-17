import type { QueryClient } from "@tanstack/react-query";

import { QueryKey as PhotoGroupsQueryKey } from "@/hooks/queries/photo-groups";
import { QueryKey as RSVPQueryKey } from "@/hooks/queries/rsvp";
import { QueryKey as ScheduleQueryKey } from "@/hooks/queries/schedule";

/**
 * Every guest-scoped (guest-token) React Query key. These caches hold a single
 * party's data, so they all belong to the party currently holding the stored
 * guest token. Any new guest-facing query must be registered here so a party
 * switch evicts it too. Admin caches are deliberately absent: they are scoped
 * to the couple's admin token, not the guest token, and must survive a guest
 * party switch.
 */
export const GUEST_QUERY_KEYS = [
  RSVPQueryKey.PartyRSVPs,
  ScheduleQueryKey.ScheduleEvents,
  PhotoGroupsQueryKey.PartyPhotoGroups,
] as const;

/**
 * Removes every guest-scoped query from the cache. Call this at a deliberate
 * party-switch boundary (a new code logging in, or "Not your party?"), where
 * one party's identity is replaced by another's: leaving the old caches behind
 * would flash (and mis-seed) the previous party's data before the refetches
 * land. It is scoped to the guest keys, never a blanket clear, so admin caches
 * survive. Do NOT wire this into the low-level `clearGuestToken`, which also
 * fires on same-party stale-token recovery (a 401 retry) where evicting an
 * in-flight query would be a bug.
 */
export function resetGuestQueries(queryClient: QueryClient): void {
  for (const queryKey of GUEST_QUERY_KEYS) {
    queryClient.removeQueries({ queryKey: [queryKey] });
  }
}
