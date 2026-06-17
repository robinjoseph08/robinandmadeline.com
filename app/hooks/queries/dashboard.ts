import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import { adminRequest, ApiError } from "@/libraries/admin-api";
import type { Response as DashboardResponse } from "@/types/generated/dashboard";

/**
 * React Query hook for the admin dashboard overview stats (GET
 * /admin/dashboard). The fetch goes through `adminRequest` (which carries the
 * admin token) and is typed end to end with the tygo-generated response type.
 *
 * The dashboard stats are computed fresh server-side on each request (no
 * caching).
 */

export enum QueryKey {
  RetrieveDashboard = "RetrieveDashboard",
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
