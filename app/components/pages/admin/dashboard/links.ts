import type {
  ListGuestsQuery,
  ListPartiesQuery,
} from "@/types/generated/parties";

// Dashboard counts link to the admin lists filtered to exactly the guests or
// parties they count. The lists read their filters from the URL (see
// useFilterParams), so a link is just the list path plus the filter params.

/**
 * Serializes a list filter into a query string, booleans as "true"/"false"
 * (the form useFilterParams parses back), skipping unset keys.
 */
function withQuery(
  path: string,
  query: Record<string, string | boolean | null | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value != null) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/** The guests list filtered to exactly the guests a dashboard count covers. */
export function guestsLink(
  query: Pick<
    ListGuestsQuery,
    | "attendance"
    | "side"
    | "relation"
    | "is_child"
    | "is_drinking"
    | "event_id"
    | "rsvp_status"
  >,
): string {
  return withQuery("/admin/guests", query);
}

/** The parties list filtered to exactly the parties a dashboard count covers. */
export function partiesLink(
  query: Pick<ListPartiesQuery, "rsvp_progress" | "info_collection_status">,
): string {
  return withQuery("/admin/parties", query);
}
