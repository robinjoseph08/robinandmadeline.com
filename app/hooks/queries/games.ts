import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import { ApiError } from "@/libraries/api";
import { fetchLeaderboard } from "@/libraries/games-api";
import type { ListLeaderboardEntriesResponse } from "@/types/generated/games";

/**
 * React Query hooks for the crossword games API. Only the leaderboard read
 * lives here: session writes are best-effort telemetry driven by timers and
 * lifecycle events, so they go through useSolveSession's queue instead of
 * mutations (a failed report must never surface to the solver).
 */

export enum QueryKey {
  GameLeaderboard = "GameLeaderboard",
}

export const useLeaderboard = (
  puzzleId: string,
  options: Omit<
    UseQueryOptions<ListLeaderboardEntriesResponse, ApiError>,
    "queryKey" | "queryFn"
  > = {},
) => {
  return useQuery<ListLeaderboardEntriesResponse, ApiError>({
    ...options,
    queryKey: [QueryKey.GameLeaderboard, puzzleId],
    queryFn: () => fetchLeaderboard(puzzleId),
  });
};
