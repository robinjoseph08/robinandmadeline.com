import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { adminRequest, ApiError } from "@/libraries/admin-api";
import type { Response as DashboardResponse } from "@/types/generated/dashboard";
import type {
  Response as SettingsResponse,
  UpdateSettingsPayload,
} from "@/types/generated/settings";

/**
 * React Query hooks for the admin dashboard: the overview stats (GET
 * /admin/dashboard) and the app settings read/write (GET/PUT /admin/settings).
 * Every fetch goes through `adminRequest` (which carries the admin token) and
 * is typed end to end with the tygo-generated response types.
 *
 * The dashboard stats are computed fresh server-side on each request (no
 * caching). The overview response also carries the RSVP deadline (for API
 * completeness; the editable field reads it from the settings query), so saving
 * a setting invalidates the overview too, keeping that field in step.
 */

export enum QueryKey {
  RetrieveDashboard = "RetrieveDashboard",
  RetrieveSettings = "RetrieveSettings",
}

export const useDashboard = (
  options: Omit<
    UseQueryOptions<DashboardResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<DashboardResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.RetrieveDashboard],
    queryFn: () => adminRequest("/admin/dashboard"),
  });
};

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
// On success it refreshes the settings query and the dashboard overview, since
// the overview response also carries the RSVP deadline the form just changed.
export const useUpdateSettings = () => {
  const queryClient = useQueryClient();

  return useMutation<SettingsResponse, ApiError, UpdateSettingsPayload>({
    mutationFn: (payload) =>
      adminRequest("/admin/settings", { method: "PUT", body: payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QueryKey.RetrieveSettings] });
      queryClient.invalidateQueries({ queryKey: [QueryKey.RetrieveDashboard] });
    },
  });
};
