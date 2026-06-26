import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import { adminRequest, ApiError } from "@/libraries/admin-api";
import type { ListTagsResponse } from "@/types/generated/parties";

/**
 * React Query hook for the guest-tag vocabulary: every distinct tag in use
 * across all parties, de-duplicated case-insensitively and sorted by the API
 * (GET /admin/guests/tags). It is the option set the admin tag comboboxes offer
 * so an existing tag can be applied to a guest even when no guest in the current
 * view carries it (the party detail page, which otherwise sees only its own
 * party's tags).
 *
 * It is a dedicated, tiny endpoint rather than a set derived from the full guest
 * list on the client, so a single party's detail page need not load every party
 * just to populate a dropdown. A guest write (which can add or remove a tag)
 * invalidates this key from the guests mutations, so the vocabulary stays fresh.
 */

export enum QueryKey {
  ListTags = "ListTags",
}

// Stable empty list so callers (and their useMemo deps) keep the same reference
// while the query is loading, rather than a fresh [] each render.
const EMPTY: string[] = [];

export const useTags = (
  options: Omit<
    UseQueryOptions<ListTagsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListTagsResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.ListTags],
    queryFn: () => adminRequest("/admin/guests/tags"),
  });
};

/** The tag vocabulary as a bare string[], the shape the comboboxes consume. */
export function useAllGuestTags(): string[] {
  return useTags().data?.items ?? EMPTY;
}
