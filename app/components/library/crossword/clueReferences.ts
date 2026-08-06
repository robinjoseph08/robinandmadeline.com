import type { Direction } from "./types";

export interface ClueReference {
  direction: Direction;
  number: string;
}

const CLUE_REFERENCE_PATTERN = /\b(\d+)\s*[-\u2013\u2014]\s*(Across|Down)\b/gi;

/** Find clue references such as "23-Across" in author-provided clue text. */
export function parseClueReferences(clue: string): ClueReference[] {
  const references: ClueReference[] = [];
  const seen = new Set<string>();

  for (const match of clue.matchAll(CLUE_REFERENCE_PATTERN)) {
    const number = match[1];
    const direction = match[2].toLowerCase() as Direction;
    const key = `${number}:${direction}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({ number, direction });
  }

  return references;
}
