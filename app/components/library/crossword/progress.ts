// Crossword progress persistence. Progress lives entirely in localStorage
// (there is no server-side game state), keyed per puzzle so guests can
// resume where they left off after a refresh.

import { DIFFICULTIES, Difficulty } from "./puzzle";

export interface CrosswordProgress {
  /** Entries string in the entriesFromGrid format ("." block, "?" empty). */
  entries: string;
  difficulty: Difficulty;
}

function storageKey(puzzleId: string): string {
  return `crossword:${puzzleId}:progress`;
}

/**
 * Load saved progress for a puzzle. Returns null when nothing usable is
 * stored: no save yet, malformed JSON, or a shape we don't recognize.
 */
export function loadProgress(puzzleId: string): CrosswordProgress | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(storageKey(puzzleId));
  } catch {
    // localStorage can throw when storage is disabled entirely.
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

  const { entries, difficulty } = parsed as Record<string, unknown>;
  if (typeof entries !== "string") {
    return null;
  }
  if (!DIFFICULTIES.includes(difficulty as Difficulty)) {
    return null;
  }

  return { entries, difficulty: difficulty as Difficulty };
}

export function saveProgress(
  puzzleId: string,
  progress: CrosswordProgress,
): void {
  try {
    localStorage.setItem(storageKey(puzzleId), JSON.stringify(progress));
  } catch {
    // Storage may be unavailable (private browsing, quota). Solving still
    // works; the puzzle just won't survive a refresh.
  }
}
