import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  SETTINGS_STORAGE_KEY,
} from "./settings";

describe("crossword settings persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("defaults match the grid's original hardcoded behavior", () => {
    // These mirror the constants the vendored navigationSettings.ts shipped
    // with, so existing solvers (and tests) see no behavior change.
    expect(DEFAULT_SETTINGS).toMatchObject({
      arrowKeyAfterDirectionChange: "stay",
      spacebarBehavior: "toggle",
      backspaceIntoPreviousWord: true,
      skipFilledSquares: true,
      jumpBackToFirstBlank: true,
      jumpToNextClue: false,
      showTimer: true,
    });
  });

  it("round-trips a full settings object", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      spacebarBehavior: "clear" as const,
      skipFilledSquares: false,
      showTimer: false,
    };
    saveSettings(settings);
    expect(loadSettings()).toEqual(settings);
  });

  it("merges a partial save onto the defaults", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ showTimer: false }),
    );
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, showTimer: false });
  });

  it("falls back per field for unrecognized values", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        spacebarBehavior: "explode",
        skipFilledSquares: "yes",
        jumpToNextClue: true,
      }),
    );
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      jumpToNextClue: true,
    });
  });

  it("ignores malformed JSON", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, "{nope");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
