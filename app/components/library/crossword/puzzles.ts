// The public puzzle registry maps the URL slug in /games/:puzzleSlug to a
// playable puzzle definition. Progress in localStorage and solve sessions on
// the backend are keyed by the puzzle's id, not its slug, so a slug can be
// renamed or retired without orphaning anyone's saved records.

import type { CrosswordPuzzle } from "./puzzle";
import { weddingMini } from "./puzzle-data";
import { weddingFull } from "./puzzle-data-full";
import { proposal } from "./puzzle-data-proposal";

export const PUZZLES_BY_SLUG: Record<string, CrosswordPuzzle> = {
  proposal,
};

// Retired definitions remain available to internal callers and historical
// component tests, but are intentionally absent from the public registry above.
const RETIRED_PUZZLES_BY_SLUG: Record<string, CrosswordPuzzle> = {
  mini: weddingMini,
  crossword: weddingFull,
};

const KNOWN_PUZZLES_BY_SLUG: Record<string, CrosswordPuzzle> = {
  ...PUZZLES_BY_SLUG,
  ...RETIRED_PUZZLES_BY_SLUG,
};

/**
 * Look up a known puzzle definition by its URL slug. Public routing must first
 * check PUZZLES_BY_SLUG so retired definitions cannot become playable again.
 * The own-property check keeps inherited keys from resolving to junk values.
 */
export function getPuzzleBySlug(slug: string): CrosswordPuzzle | undefined {
  return Object.prototype.hasOwnProperty.call(KNOWN_PUZZLES_BY_SLUG, slug)
    ? KNOWN_PUZZLES_BY_SLUG[slug]
    : undefined;
}

// Solve sessions retain stable puzzle ids after a puzzle leaves the public
// catalog. Keep historical titles here so old admin records stay legible even
// though retired puzzles can no longer be opened from a public route.
const PUZZLE_TITLES_BY_ID: Record<string, string> = {
  "wedding-mini-v1": "The Wedding Mini",
  "wedding-full-v1": "The Wedding Crossword",
  [proposal.id]: proposal.title,
};

/**
 * Friendly title for a stored puzzle id. Falls back to the raw id for an id we
 * have never seen, so an unknown record is still displayed rather than blank.
 */
export function getPuzzleTitle(puzzleId: string): string {
  return Object.prototype.hasOwnProperty.call(PUZZLE_TITLES_BY_ID, puzzleId)
    ? PUZZLE_TITLES_BY_ID[puzzleId]
    : puzzleId;
}
