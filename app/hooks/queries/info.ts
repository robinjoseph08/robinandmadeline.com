import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { ApiError, apiRequest } from "@/libraries/api";
import type {
  PartyInfoResponse,
  UpdatePartyInfoPayload,
} from "@/types/generated/info";

/**
 * React Query hooks for the guest info-collection API. There is no JWT: the
 * opaque per-party token from the /i/:token URL is the authentication, so the
 * fetches go through the bare `apiRequest`. The hooks are typed end to end
 * with the tygo-generated request/response types. The surface is a single
 * resource (the token's party info), so there is one query key per token and
 * the PUT response simply replaces the cached view.
 */

export enum QueryKey {
  PartyInfo = "PartyInfo",
}

/** The API path for a token, with the token safely encoded into the URL. */
function infoPath(token: string): string {
  return `/info/${encodeURIComponent(token)}`;
}

export const usePartyInfo = (token: string) => {
  return useQuery<PartyInfoResponse, ApiError>({
    queryKey: [QueryKey.PartyInfo, token],
    queryFn: () => apiRequest(infoPath(token)),
  });
};

// useUpdatePartyInfo submits the whole info form at once. The backend responds
// with the refreshed view, which replaces the cached query data so the form
// re-seeds from the saved state (removed guests gone, corrections applied)
// without a refetch.
export const useUpdatePartyInfo = (token: string) => {
  const queryClient = useQueryClient();

  return useMutation<PartyInfoResponse, ApiError, UpdatePartyInfoPayload>({
    mutationFn: (payload) =>
      apiRequest(infoPath(token), { method: "PUT", body: payload }),
    onSuccess: (data) => {
      queryClient.setQueryData([QueryKey.PartyInfo, token], data);
    },
  });
};
