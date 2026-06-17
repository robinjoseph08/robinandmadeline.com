// Solver preferences persisted in localStorage under one key, global across
// puzzles, like the NYT crossword's gear menu. The navigation subset feeds
// the Grid's cursor behavior; showTimer only controls whether the elapsed
// readout renders (every solve is timed and reported regardless).

import {
  DEFAULT_NAVIGATION_SETTINGS,
  NavigationSettings,
} from "./navigationSettings";

export interface CrosswordSettings extends NavigationSettings {
  /** Display-only: hide or show the timer readout while solving. */
  showTimer: boolean;
}

export const SETTINGS_STORAGE_KEY = "crossword:settings";

export const DEFAULT_SETTINGS: CrosswordSettings = {
  ...DEFAULT_NAVIGATION_SETTINGS,
  showTimer: true,
};

/**
 * Load the persisted settings, falling back to the defaults for anything
 * missing or malformed. Each field is validated independently so one bad
 * value (or a save from an older shape) never discards the rest.
 */
export function loadSettings(): CrosswordSettings {
  let raw: string | null;
  try {
    raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (!raw) {
    return { ...DEFAULT_SETTINGS };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ...DEFAULT_SETTINGS };
  }

  const stored = parsed as Record<string, unknown>;
  const settings = { ...DEFAULT_SETTINGS };

  if (stored.arrowKeyAfterDirectionChange === "stay") {
    settings.arrowKeyAfterDirectionChange = "stay";
  } else if (stored.arrowKeyAfterDirectionChange === "move") {
    settings.arrowKeyAfterDirectionChange = "move";
  }
  if (stored.spacebarBehavior === "toggle") {
    settings.spacebarBehavior = "toggle";
  } else if (stored.spacebarBehavior === "clear") {
    settings.spacebarBehavior = "clear";
  }
  for (const key of [
    "backspaceIntoPreviousWord",
    "skipFilledSquares",
    "jumpBackToFirstBlank",
    "jumpToNextClue",
    "showTimer",
  ] as const) {
    if (typeof stored[key] === "boolean") {
      settings[key] = stored[key];
    }
  }

  return settings;
}

export function saveSettings(settings: CrosswordSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage may be unavailable (private browsing, quota). The settings
    // still apply for this visit; they just won't survive a refresh.
  }
}
