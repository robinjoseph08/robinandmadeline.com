import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearSessionRecord,
  loadSessionRecord,
  MAX_CHECK_COUNT,
  saveSessionRecord,
} from "./session";

const PUZZLE_ID = "wedding-mini-v1";
const KEY = `crossword:${PUZZLE_ID}:session`;

describe("solve session record persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when nothing is stored", () => {
    expect(loadSessionRecord(PUZZLE_ID)).toBeNull();
  });

  it("round-trips a record, including check totals before session creation", () => {
    saveSessionRecord(PUZZLE_ID, {
      id: null,
      elapsedMs: 1234,
      completed: false,
      difficulty: "medium",
      squareChecks: 1,
      wordChecks: 2,
      gridChecks: 3,
      postedName: undefined,
    });
    expect(loadSessionRecord(PUZZLE_ID)).toEqual({
      id: null,
      elapsedMs: 1234,
      completed: false,
      difficulty: "medium",
      squareChecks: 1,
      wordChecks: 2,
      gridChecks: 3,
      postedName: undefined,
    });
  });

  it("round-trips an unverified compatibility fallback", () => {
    saveSessionRecord(PUZZLE_ID, {
      id: "sess-legacy",
      elapsedMs: 45000,
      completed: false,
      difficulty: "easy",
      difficultyUnverified: true,
      squareChecks: 0,
      wordChecks: 0,
      gridChecks: 0,
    });
    expect(loadSessionRecord(PUZZLE_ID)).toEqual({
      id: "sess-legacy",
      elapsedMs: 45000,
      completed: false,
      difficulty: "easy",
      difficultyUnverified: true,
      squareChecks: 0,
      wordChecks: 0,
      gridChecks: 0,
      postedName: undefined,
    });
  });

  it("clears one puzzle's saved session", () => {
    saveSessionRecord(PUZZLE_ID, {
      id: "sess-1",
      elapsedMs: 90000,
      completed: true,
      difficulty: "easy",
      squareChecks: 0,
      wordChecks: 0,
      gridChecks: 0,
    });

    clearSessionRecord(PUZZLE_ID);

    expect(loadSessionRecord(PUZZLE_ID)).toBeNull();
  });

  it("swallows storage errors while clearing", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(() => clearSessionRecord(PUZZLE_ID)).not.toThrow();
  });

  it("keeps the posted name and completion flag", () => {
    saveSessionRecord(PUZZLE_ID, {
      id: "sess-1",
      elapsedMs: 90000,
      completed: true,
      difficulty: "easy",
      squareChecks: 0,
      wordChecks: 0,
      gridChecks: 0,
      postedName: "Alice",
    });
    expect(loadSessionRecord(PUZZLE_ID)).toEqual({
      id: "sess-1",
      elapsedMs: 90000,
      completed: true,
      difficulty: "easy",
      squareChecks: 0,
      wordChecks: 0,
      gridChecks: 0,
      postedName: "Alice",
    });
  });

  it("rejects shapes it does not recognize", () => {
    localStorage.setItem(KEY, JSON.stringify({ id: 42, elapsedMs: 10 }));
    expect(loadSessionRecord(PUZZLE_ID)).toBeNull();

    localStorage.setItem(KEY, JSON.stringify({ id: "sess-1" }));
    expect(loadSessionRecord(PUZZLE_ID)).toBeNull();

    localStorage.setItem(KEY, "{nope");
    expect(loadSessionRecord(PUZZLE_ID)).toBeNull();
  });

  it("defaults legacy check counts and clamps malformed totals", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        id: "sess-legacy",
        elapsedMs: 100,
        completed: false,
        difficulty: "easy",
      }),
    );
    expect(loadSessionRecord(PUZZLE_ID)).toMatchObject({
      squareChecks: 0,
      wordChecks: 0,
      gridChecks: 0,
    });

    localStorage.setItem(
      KEY,
      JSON.stringify({
        id: "sess-bad-counts",
        elapsedMs: 100,
        completed: false,
        difficulty: "easy",
        squareChecks: -4,
        wordChecks: 2.8,
        gridChecks: MAX_CHECK_COUNT + 50,
      }),
    );
    expect(loadSessionRecord(PUZZLE_ID)).toMatchObject({
      squareChecks: 0,
      wordChecks: 2,
      gridChecks: MAX_CHECK_COUNT,
    });
  });

  it("degrades unknown difficulties and negative elapsed values", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        id: "sess-1",
        elapsedMs: -50,
        completed: "maybe",
        difficulty: "impossible",
      }),
    );
    expect(loadSessionRecord(PUZZLE_ID)).toEqual({
      id: "sess-1",
      elapsedMs: 0,
      completed: false,
      difficulty: undefined,
      squareChecks: 0,
      wordChecks: 0,
      gridChecks: 0,
      postedName: undefined,
    });
  });
});
