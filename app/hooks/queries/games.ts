import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";

import { adminRequest } from "@/libraries/admin-api";
import { ApiError } from "@/libraries/api";
import { fetchLeaderboard } from "@/libraries/games-api";
import type {
  ListAdminGameSessionsResponse,
  ListLeaderboardEntriesResponse,
} from "@/types/generated/games";
import type { GameDifficulty } from "@/types/generated/models";

/**
 * React Query hooks for the crossword games API. The guest-facing leaderboard
 * read lives here: solver session writes are best-effort telemetry driven by
 * timers and lifecycle events, so they go through useSolveSession's queue
 * instead of mutations (a failed report must never surface to the solver). The
 * admin sessions list and delete also live here; they are normal admin
 * mutations (a failure must surface to the admin), so unlike the solver writes
 * they go through adminRequest with the admin token.
 */

export enum QueryKey {
  GameLeaderboard = "GameLeaderboard",
  AdminGameSessions = "AdminGameSessions",
}

export const useLeaderboard = (
  puzzleId: string,
  difficulty: GameDifficulty,
  options: Omit<
    UseQueryOptions<ListLeaderboardEntriesResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
  // The solver's own session id (when known): passing it asks the backend to
  // include the solver's own ranked row, so the dialog can always show them
  // their place even past the displayed top N.
  sessionId?: string,
) => {
  return useQuery<ListLeaderboardEntriesResponse, ApiError>({
    ...options,
    // The difficulty is part of the key so each leaderboard tab caches its
    // own list; the session id follows it so a viewer-aware read (one carrying
    // the solver's session id) caches apart from an anonymous read of the same
    // tab. Invalidating the [QueryKey, puzzleId] prefix still sweeps every tab
    // and both variants.
    queryKey: [QueryKey.GameLeaderboard, puzzleId, difficulty, sessionId],
    queryFn: () => fetchLeaderboard(puzzleId, difficulty, sessionId),
  });
};

// useAdminGameSessions reads the admin solve-times list: every session
// regardless of state (in-progress, completed-unposted, posted), newest first,
// with the admin-only ip_address. Behind the admin token via adminRequest.
export const useAdminGameSessions = (
  options: Omit<
    UseQueryOptions<ListAdminGameSessionsResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListAdminGameSessionsResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.AdminGameSessions],
    queryFn: () => adminRequest("/admin/games/sessions"),
  });
};

// useDeleteGameSession deletes one solve session (the admin cleanup for a bad
// actor). The DELETE returns 204 (no body), so the mutation resolves to void;
// on success it invalidates the admin sessions list to drop the deleted row.
export const useDeleteGameSession = () => {
  const queryClient = useQueryClient();

  return useMutation<void, ApiError, { sessionId: string }>({
    mutationFn: ({ sessionId }) =>
      adminRequest(`/admin/games/sessions/${sessionId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: [QueryKey.AdminGameSessions],
      });
    },
  });
};
