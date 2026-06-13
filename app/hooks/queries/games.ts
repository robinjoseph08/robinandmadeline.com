import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

import { ApiError } from "@/libraries/api";
import { fetchLeaderboard } from "@/libraries/games-api";
import type { ListLeaderboardEntriesResponse } from "@/types/generated/games";
import type { GameDifficulty } from "@/types/generated/models";

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
    // own list; the session id follows it so a viewer-aware read (after a
    // post) doesn't collide with the anonymous warm-up. Invalidating the
    // [QueryKey, puzzleId] prefix still sweeps every tab and both variants.
    queryKey: [QueryKey.GameLeaderboard, puzzleId, difficulty, sessionId],
    queryFn: () => fetchLeaderboard(puzzleId, difficulty, sessionId),
  });
};
