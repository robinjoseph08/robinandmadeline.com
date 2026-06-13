/**
 * Crossword solve-session API helpers, layered on the bare `apiRequest`
 * (api.ts) like guest-api.ts and admin-api.ts.
 *
 * Sessions need no authentication: a session's UUID id doubles as its bearer
 * token, so holding the id is what authorizes writes to it. When a guest JWT
 * is stored (the RSVP login), it is attached so the solve is affiliated with
 * the party; a 401 means that stored token went stale, so it is cleared and
 * the request retried anonymously rather than failing the solve.
 */

import { ApiError, apiRequest } from "@/libraries/api";
import { clearGuestToken, readGuestToken } from "@/libraries/guest-api";
import type {
  CreateGameSessionPayload,
  GameSessionResponse,
  ListLeaderboardEntriesResponse,
  PostLeaderboardPayload,
  UpdateGameSessionPayload,
} from "@/types/generated/games";
import type { GameDifficulty } from "@/types/generated/models";

interface GameRequestOptions {
  method?: string;
  body?: unknown;
  /** Forwarded through apiRequest to fetch; see flushGameSession. */
  keepalive?: boolean;
}

/**
 * Performs a games API request with the persisted guest token attached when
 * present. On a 401 (stale guest token) the token is cleared and the request
 * retried anonymously: the games endpoints themselves are open, so the only
 * thing a bad token can break is the party affiliation.
 */
async function gameRequest<T>(
  path: string,
  options: GameRequestOptions = {},
): Promise<T> {
  const token = readGuestToken();
  try {
    return await apiRequest<T>(path, { ...options, token });
  } catch (err) {
    if (token && err instanceof ApiError && err.status === 401) {
      clearGuestToken();
      return apiRequest<T>(path, { ...options, token: null });
    }
    throw err;
  }
}

/** Starts a solve session: POST /api/games/sessions. */
export function createGameSession(
  payload: CreateGameSessionPayload,
): Promise<GameSessionResponse> {
  return gameRequest("/games/sessions", { method: "POST", body: payload });
}

/** Reports solve progress: PATCH /api/games/sessions/:id. */
export function updateGameSession(
  id: string,
  payload: UpdateGameSessionPayload,
): Promise<GameSessionResponse> {
  return gameRequest(`/games/sessions/${id}`, {
    method: "PATCH",
    body: payload,
  });
}

/** Publishes a completed solve: POST /api/games/sessions/:id/leaderboard. */
export function postLeaderboardEntry(
  id: string,
  payload: PostLeaderboardPayload,
): Promise<GameSessionResponse> {
  return gameRequest(`/games/sessions/${id}/leaderboard`, {
    method: "POST",
    body: payload,
  });
}

/**
 * Reads a puzzle's leaderboard, fastest first, scoped to one difficulty:
 * GET /api/games/leaderboard. When a sessionId is given (the solver's own
 * session, whose UUID doubles as its bearer token), the response carries that
 * solver's own ranked row (viewer) so the client can always show them their
 * place, even when it falls past the displayed top N.
 */
export function fetchLeaderboard(
  puzzleId: string,
  difficulty: GameDifficulty,
  sessionId?: string,
): Promise<ListLeaderboardEntriesResponse> {
  const params = new URLSearchParams({
    puzzle_id: puzzleId,
    difficulty,
  });
  if (sessionId) {
    params.set("session_id", sessionId);
  }
  return apiRequest(`/games/leaderboard?${params.toString()}`);
}

/**
 * Fire-and-forget progress report for the moments the page is going away
 * (visibilitychange to hidden, pagehide). A keepalive fetch survives the
 * navigation, where a normal fetch would be aborted; the flag rides through
 * gameRequest, so the 401 clear-and-retry inherits it too. The result is
 * deliberately ignored because there is nobody left to react to it.
 */
export function flushGameSession(
  id: string,
  payload: UpdateGameSessionPayload,
): void {
  try {
    void gameRequest(`/games/sessions/${id}`, {
      method: "PATCH",
      body: payload,
      keepalive: true,
    }).catch(() => {
      // Telemetry only; the next regular report retries.
    });
  } catch {
    // fetch itself can throw in exotic environments; never break solving.
  }
}
