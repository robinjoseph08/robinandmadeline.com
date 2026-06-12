import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { adminRequest, ApiError } from "@/libraries/admin-api";
import { guestRequest } from "@/libraries/guest-api";
import type {
  AddPhotoGroupGuestPayload,
  CreatePhotoGroupPayload,
  ListPartyPhotoGroupsResponse,
  ListPhotoGroupsResponse,
  PhotoGroupResponse,
  ReorderPhotoGroupsPayload,
  UpdatePhotoGroupPayload,
} from "@/types/generated/photogroups";

/**
 * React Query hooks for the photo-groups API (the photographer's shot list,
 * one global shooting order). The admin hooks go through `adminRequest` (which
 * carries the admin token) and render the whole list from one query, so each
 * mutation simply invalidates that list: the dataset is wedding-sized and the
 * refetch is one request. The one guest-facing hook (usePartyPhotoGroups)
 * goes through `guestRequest` instead, which carries the persisted guest
 * token. All hooks are typed end to end with the tygo-generated
 * request/response types.
 */

export enum QueryKey {
  ListPhotoGroups = "ListPhotoGroups",
  PartyPhotoGroups = "PartyPhotoGroups",
}

export const usePhotoGroups = (
  options: Omit<
    UseQueryOptions<ListPhotoGroupsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListPhotoGroupsResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.ListPhotoGroups],
    queryFn: () => adminRequest("/admin/photo-groups"),
  });
};

// usePartyPhotoGroups fetches the authenticated party's photo groups (GET
// /api/guest/photo-groups): the groups the party's guests are in, each naming
// which of the party's guests it needs, with positions in the shooting order.
// Callers gate it with `enabled` on having a guest session; the request 401s
// without a valid token.
export const usePartyPhotoGroups = (
  options: Omit<
    UseQueryOptions<ListPartyPhotoGroupsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListPartyPhotoGroupsResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.PartyPhotoGroups],
    queryFn: () => guestRequest("/guest/photo-groups"),
  });
};

export const useCreatePhotoGroup = () => {
  const queryClient = useQueryClient();

  return useMutation<PhotoGroupResponse, ApiError, CreatePhotoGroupPayload>({
    mutationFn: (payload) =>
      adminRequest("/admin/photo-groups", { method: "POST", body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.ListPhotoGroups],
      });
    },
  });
};

export const useUpdatePhotoGroup = () => {
  const queryClient = useQueryClient();

  return useMutation<
    PhotoGroupResponse,
    ApiError,
    { photoGroupId: string; payload: UpdatePhotoGroupPayload }
  >({
    mutationFn: ({ photoGroupId, payload }) =>
      adminRequest(`/admin/photo-groups/${photoGroupId}`, {
        method: "PUT",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.ListPhotoGroups],
      });
    },
  });
};

export const useDeletePhotoGroup = () => {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, { photoGroupId: string }>({
    mutationFn: ({ photoGroupId }) =>
      adminRequest(`/admin/photo-groups/${photoGroupId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.ListPhotoGroups],
      });
    },
  });
};

// useReorderPhotoGroups rewrites the shooting order: the payload carries
// every photo group id in its new order (each of them exactly once).
export const useReorderPhotoGroups = () => {
  const queryClient = useQueryClient();

  return useMutation<
    ListPhotoGroupsResponse,
    ApiError,
    ReorderPhotoGroupsPayload
  >({
    mutationFn: (payload) =>
      adminRequest("/admin/photo-groups/reorder", {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      // A move's payload is computed from the currently rendered order, so
      // hold the mutation pending (keeping the move buttons disabled) until
      // the refetched order lands; otherwise a quick second move would swap
      // against the stale list.
      return queryClient.invalidateQueries({
        queryKey: [QueryKey.ListPhotoGroups],
      });
    },
  });
};

export const useAddPhotoGroupGuest = () => {
  const queryClient = useQueryClient();

  return useMutation<
    PhotoGroupResponse,
    ApiError,
    { photoGroupId: string; payload: AddPhotoGroupGuestPayload }
  >({
    mutationFn: ({ photoGroupId, payload }) =>
      adminRequest(`/admin/photo-groups/${photoGroupId}/guests`, {
        method: "POST",
        body: payload,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.ListPhotoGroups],
      });
    },
  });
};

export const useRemovePhotoGroupGuest = () => {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, { photoGroupId: string; guestId: string }>(
    {
      mutationFn: ({ photoGroupId, guestId }) =>
        adminRequest(`/admin/photo-groups/${photoGroupId}/guests/${guestId}`, {
          method: "DELETE",
        }),
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: [QueryKey.ListPhotoGroups],
        });
      },
    },
  );
};
