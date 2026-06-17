import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { adminRequest, ApiError } from "@/libraries/admin-api";
import type {
  Response as SettingsResponse,
  UpdateSettingsPayload,
} from "@/types/generated/settings";

/**
 * React Query hooks for the app settings (GET/PUT /admin/settings), edited on
 * the admin settings page. Every fetch goes through `adminRequest` (which
 * carries the admin token) and is typed end to end with the tygo-generated
 * response types.
 */

export enum QueryKey {
  RetrieveSettings = "RetrieveSettings",
}

export const useSettings = (
  options: Omit<
    UseQueryOptions<SettingsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<SettingsResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.RetrieveSettings],
    queryFn: () => adminRequest("/admin/settings"),
  });
};

// useUpdateSettings saves a partial settings change (each field independently).
// On success it refreshes the settings query so the form re-seeds from the
// saved values.
export const useUpdateSettings = () => {
  const queryClient = useQueryClient();

  return useMutation<SettingsResponse, ApiError, UpdateSettingsPayload>({
    mutationFn: (payload) =>
      adminRequest("/admin/settings", { method: "PUT", body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKey.RetrieveSettings] });
    },
  });
};
