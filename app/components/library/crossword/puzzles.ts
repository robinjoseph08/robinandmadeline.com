// The puzzle registry: maps the URL slug in /games/:puzzleSlug to a puzzle
// definition, so the mini lives at /games/mini and the full 15x15 at
// /games/crossword. Progress in localStorage and solve sessions on the
// backend are keyed by the puzzle's id (not its slug), so a slug can be
// renamed without orphaning anyone's saved grid.

import type { CrosswordPuzzle } from "./puzzle";
import { weddingMini } from "./puzzle-data";
import { weddingFull } from "./puzzle-data-full";

export const PUZZLES_BY_SLUG: Record<string, CrosswordPuzzle> = {
  mini: weddingMini,
  crossword: weddingFull,
};

/**
 * Look up a puzzle by its URL slug. The own-property check means inherited
 * keys like "constructor" in the URL can never resolve to a non-puzzle value.
 */
export function getPuzzleBySlug(slug: string): CrosswordPuzzle | undefined {
  return Object.prototype.hasOwnProperty.call(PUZZLES_BY_SLUG, slug)
    ? PUZZLES_BY_SLUG[slug]
    : undefined;
}

// Puzzles keyed by their stable id (not slug). Solve sessions on the backend
// store the puzzle id, so the admin view maps an id back to a friendly title
// through this; built from the same registry so it stays in sync.
const PUZZLES_BY_ID: Record<string, CrosswordPuzzle> = Object.fromEntries(
  Object.values(PUZZLES_BY_SLUG).map((puzzle) => [puzzle.id, puzzle]),
);

/**
 * Friendly title for a stored puzzle id ("wedding-mini-v1" becomes "The
 * Wedding Mini"). Falls back to the raw id for an id not in the registry, so a
 * renamed-or-retired puzzle's old sessions stay legible rather than blank.
 */
export function getPuzzleTitle(puzzleId: string): string {
  return Object.prototype.hasOwnProperty.call(PUZZLES_BY_ID, puzzleId)
    ? PUZZLES_BY_ID[puzzleId].title
    : puzzleId;
}
