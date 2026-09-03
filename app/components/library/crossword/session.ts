// The client half of a backend solve session (pkg/games), persisted next to
// the grid progress so a returning guest resumes the SAME session: the
// session's UUID id (which doubles as its bearer token), the locally
// accumulated active-solving milliseconds, and the completion state.

import { DIFFICULTIES, Difficulty } from "./puzzle";

/** Matches the backend's per-scope check-count ceiling. */
export const MAX_CHECK_COUNT = 1_000_000;

export interface SolveSessionRecord {
  /** Backend session UUID; null while creation hasn't succeeded yet. */
  id: string | null;
  /** Total accumulated active-solving milliseconds (never a delta). */
  elapsedMs: number;
  /** True once the backend considers the solve final (acked or 409'd). */
  completed: boolean;
  /** Cumulative explicit checks, kept separately by scope. */
  squareChecks: number;
  wordChecks: number;
  gridChecks: number;
  /**
   * The easiest difficulty used during the solve, as last reported by the
   * server (authoritative) or tracked locally while offline.
   */
  difficulty?: Difficulty;
  /**
   * True while the local difficulty is only a compatibility fallback and has
   * not yet been confirmed by a successful server response.
   */
  difficultyUnverified?: boolean;
  /** The display name posted to the leaderboard, once the guest opted in. */
  postedName?: string;
}

function storageKey(puzzleId: string): string {
  return `crossword:${puzzleId}:session`;
}

/**
 * Load the persisted session record for a puzzle. Returns null when nothing
 * usable is stored, same defensive posture as progress.ts: a malformed save
 * degrades to "no session" (a fresh one is created lazily) rather than a
 * crash.
 */
export function loadSessionRecord(puzzleId: string): SolveSessionRecord | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(puzzleId));
  } catch {
    return null;
  }
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const {
    id,
    elapsedMs,
    completed,
    difficulty,
    difficultyUnverified,
    postedName,
    squareChecks,
    wordChecks,
    gridChecks,
  } = parsed as Record<string, unknown>;
  if (typeof id !== "string" && id !== null) {
    return null;
  }
  if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs)) {
    return null;
  }

  return {
    id: id ?? null,
    elapsedMs: Math.max(0, elapsedMs),
    completed: completed === true,
    squareChecks: storedCheckCount(squareChecks),
    wordChecks: storedCheckCount(wordChecks),
    gridChecks: storedCheckCount(gridChecks),
    difficulty: DIFFICULTIES.includes(difficulty as Difficulty)
      ? (difficulty as Difficulty)
      : undefined,
    ...(difficultyUnverified === true ? { difficultyUnverified: true } : {}),
    postedName: typeof postedName === "string" ? postedName : undefined,
  };
}

function storedCheckCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.min(Math.floor(value), MAX_CHECK_COUNT)
    : 0;
}

export function clearSessionRecord(puzzleId: string): void {
  try {
    localStorage.removeItem(storageKey(puzzleId));
  } catch {
    // Storage may be unavailable. The current solve can still be discarded
    // in memory even if the browser refuses to remove the persisted copy.
  }
}

export function saveSessionRecord(
  puzzleId: string,
  record: SolveSessionRecord,
): void {
  try {
    localStorage.setItem(storageKey(puzzleId), JSON.stringify(record));
  } catch {
    // Storage may be unavailable. Solving and reporting still work; the
    // session just won't be resumable after a refresh.
  }
}
