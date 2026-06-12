import { beforeEach, describe, expect, it } from "vitest";

import { loadSessionRecord, saveSessionRecord } from "./session";

const PUZZLE_ID = "wedding-mini-v1";
const KEY = `crossword:${PUZZLE_ID}:session`;

describe("solve session record persistence", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns null when nothing is stored", () => {
    expect(loadSessionRecord(PUZZLE_ID)).toBeNull();
  });

  it("round-trips a record, including a not-yet-created session", () => {
    saveSessionRecord(PUZZLE_ID, {
      id: null,
      elapsedMs: 1234,
      completed: false,
      difficulty: "medium",
      postedName: undefined,
    });
    expect(loadSessionRecord(PUZZLE_ID)).toEqual({
      id: null,
      elapsedMs: 1234,
      completed: false,
      difficulty: "medium",
      postedName: undefined,
    });
  });

  it("keeps the posted name and completion flag", () => {
    saveSessionRecord(PUZZLE_ID, {
      id: "sess-1",
      elapsedMs: 90000,
      completed: true,
      difficulty: "easy",
      postedName: "Alice",
    });
    expect(loadSessionRecord(PUZZLE_ID)).toEqual({
      id: "sess-1",
      elapsedMs: 90000,
      completed: true,
      difficulty: "easy",
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
      postedName: undefined,
    });
  });
});
