import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { adminRequest, ApiError } from "@/libraries/admin-api";
import type {
  AddPhotoGroupGuestPayload,
  CreatePhotoGroupPayload,
  ListPhotoGroupsQuery,
  ListPhotoGroupsResponse,
  PhotoGroupResponse,
  ReorderPhotoGroupsPayload,
  UpdatePhotoGroupPayload,
} from "@/types/generated/photogroups";

/**
 * React Query hooks for the photo-groups admin API (the photographer's
 * per-event shot list). Every fetch goes through `adminRequest` (which carries
 * the admin token); the hooks are typed end to end with the tygo-generated
 * request/response types. The admin page renders every event's groups from
 * one unfiltered list query, so each mutation simply invalidates that list:
 * the dataset is wedding-sized and the refetch is one request.
 */

export enum QueryKey {
  ListPhotoGroups = "ListPhotoGroups",
}

export const usePhotoGroups = (
  query: ListPhotoGroupsQuery = {},
  options: Omit<
    UseQueryOptions<ListPhotoGroupsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListPhotoGroupsResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.ListPhotoGroups, query],
    queryFn: () => adminRequest("/admin/photo-groups", { query }),
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

// useReorderPhotoGroups rewrites one event's shooting order: the payload
// carries the event's photo group ids in their new order (each of them
// exactly once).
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
