// Focused unit tests for useSolveSession's locking invariants, isolated from
// the page wiring. The full solve flows (heartbeat, pause accounting, flushes,
// error recovery, the leaderboard handoff) run through the page in
// Crossword.session.test.tsx; these pin the hook guards directly so removing
// one is caught here even if a page-level guard happens to mask it there.

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/libraries/api";
import type { UpdateGameSessionPayload } from "@/types/generated/games";
import type { GameSession } from "@/types/generated/models";

import { useSolveSession } from "./useSolveSession";

const apiRequest = vi.fn();
vi.mock("@/libraries/api", async () => {
  const actual = await vi.importActual<object>("@/libraries/api");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  };
});

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "sess-1",
    puzzle_id: "wedding-mini-v1",
    party_id: undefined,
    difficulty: "easy",
    elapsed_ms: 0,
    completed_at: undefined,
    on_leaderboard: false,
    display_name: undefined,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** A create/update API that echoes the difficulty the caller sent. */
function mockApi() {
  apiRequest.mockImplementation(
    (path: string, options?: { method?: string; body?: unknown }) => {
      const method = options?.method ?? "GET";
      if (path === "/games/sessions" && method === "POST") {
        const body = options?.body as { difficulty: GameSession["difficulty"] };
        return Promise.resolve(makeSession({ difficulty: body.difficulty }));
      }
      if (path.startsWith("/games/sessions/") && method === "PATCH") {
        const body = options?.body as UpdateGameSessionPayload;
        return Promise.resolve(
          makeSession({
            difficulty: body.difficulty ?? "easy",
            completed_at: body.completed ? "2026-01-01T00:01:00Z" : undefined,
          }),
        );
      }
      return Promise.reject(new Error(`unexpected ${method} ${path}`));
    },
  );
}

/** Every difficulty carried on a PATCH report so far (a report may omit it). */
function reportedDifficulties(): Array<GameSession["difficulty"] | undefined> {
  return apiRequest.mock.calls
    .filter(
      ([path, options]) =>
        typeof path === "string" &&
        path.startsWith("/games/sessions/") &&
        (options?.method ?? "GET") === "PATCH",
    )
    .map(
      ([, options]) => (options?.body as UpdateGameSessionPayload).difficulty,
    );
}

/** Every elapsed_ms carried on a PATCH report so far. */
function reportedElapsed(): number[] {
  return apiRequest.mock.calls
    .filter(
      ([path, options]) =>
        typeof path === "string" &&
        path.startsWith("/games/sessions/") &&
        (options?.method ?? "GET") === "PATCH",
    )
    .map(
      ([, options]) =>
        (options?.body as UpdateGameSessionPayload).elapsed_ms ?? 0,
    );
}

/** Drain the hook's serialized report queue. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useSolveSession locking", () => {
  beforeEach(() => {
    localStorage.clear();
    apiRequest.mockReset();
    mockApi();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("preserves a restored session while falling back from an unavailable difficulty", async () => {
    localStorage.setItem(
      "crossword:proposal-v1:session",
      JSON.stringify({
        id: "sess-legacy",
        elapsedMs: 45_000,
        completed: false,
        difficulty: "medium",
      }),
    );

    const { result } = renderHook(() =>
      useSolveSession({
        puzzleId: "proposal-v1",
        availableDifficulties: ["easy", "hard"],
        initiallyStarted: true,
        initialDifficulty: "easy",
        initiallyPaused: true,
      }),
    );

    expect(result.current.sessionId).toBe("sess-legacy");
    expect(result.current.elapsedMs).toBe(45_000);
    expect(result.current.recordedDifficulty).toBe("easy");
    expect(result.current.finished).toBe(false);
    expect(result.current.postable).toBe(false);

    act(() => result.current.reportDifficulty("easy"));
    await flush();

    expect(apiRequest).toHaveBeenCalledWith(
      "/games/sessions/sess-legacy",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({ difficulty: "easy" }),
      }),
    );
    await waitFor(() => expect(result.current.postable).toBe(true));
  });

  it("blocks a completed legacy session whose difficulty is missing", () => {
    localStorage.setItem(
      "crossword:proposal-v1:session",
      JSON.stringify({
        id: "sess-legacy",
        elapsedMs: 45_000,
        completed: true,
      }),
    );

    const { result } = renderHook(() =>
      useSolveSession({
        puzzleId: "proposal-v1",
        availableDifficulties: ["easy", "hard"],
        initiallyStarted: true,
        initialDifficulty: "easy",
      }),
    );

    expect(result.current.sessionId).toBe("sess-legacy");
    expect(result.current.elapsedMs).toBe(45_000);
    expect(result.current.recordedDifficulty).toBe("easy");
    expect(result.current.finished).toBe(true);
    expect(result.current.postable).toBe(false);
  });

  it("does not expose an unavailable difficulty returned by the server", async () => {
    localStorage.setItem(
      "crossword:proposal-v1:session",
      JSON.stringify({
        id: "sess-legacy",
        elapsedMs: 45_000,
        completed: false,
        difficulty: "easy",
      }),
    );
    apiRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        if (
          path === "/games/sessions/sess-legacy" &&
          options?.method === "PATCH"
        ) {
          return Promise.resolve(makeSession({ difficulty: "medium" }));
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      },
    );

    const { result } = renderHook(() =>
      useSolveSession({
        puzzleId: "proposal-v1",
        availableDifficulties: ["easy", "hard"],
        initiallyStarted: true,
        initialDifficulty: "easy",
        initiallyPaused: true,
      }),
    );

    act(() => result.current.reportDifficulty("easy"));
    await flush();

    expect(result.current.recordedDifficulty).toBe("easy");
    expect(result.current.postable).toBe(false);
  });

  it("marks a conflict-finalized restored session unpostable", async () => {
    localStorage.setItem(
      "crossword:wedding-mini-v1:session",
      JSON.stringify({
        id: "sess-final",
        elapsedMs: 45_000,
        completed: false,
        difficulty: "easy",
      }),
    );
    apiRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        if (
          path === "/games/sessions/sess-final" &&
          options?.method === "PATCH"
        ) {
          return Promise.reject(new ApiError(409, "completed"));
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      },
    );

    const { result } = renderHook(() =>
      useSolveSession({
        puzzleId: "wedding-mini-v1",
        availableDifficulties: ["easy", "medium", "hard"],
        initiallyStarted: true,
        initialDifficulty: "easy",
        initiallyPaused: true,
      }),
    );

    act(() => result.current.reportDifficulty("easy"));
    await flush();

    await waitFor(() => expect(result.current.finished).toBe(true));
    expect(result.current.postable).toBe(false);
    await expect(result.current.postToLeaderboard("Robin")).rejects.toThrow(
      /can't verify/i,
    );
  });

  it("ignores a session creation that finishes after the local solve is discarded", async () => {
    const key = "crossword:wedding-mini-v1:session";
    let resolveCreate: ((session: GameSession) => void) | undefined;
    apiRequest.mockImplementation(
      (path: string, options?: { method?: string }) => {
        if (path === "/games/sessions" && options?.method === "POST") {
          return new Promise<GameSession>((resolve) => {
            resolveCreate = resolve;
          });
        }
        return Promise.reject(new Error(`unexpected ${path}`));
      },
    );

    const { result } = renderHook(() =>
      useSolveSession({
        puzzleId: "wedding-mini-v1",
        availableDifficulties: ["easy", "medium", "hard"],
        initiallyStarted: false,
        initialDifficulty: "easy",
      }),
    );

    act(() => result.current.start("easy"));
    expect(localStorage.getItem(key)).not.toBeNull();
    act(() => result.current.discardLocalRecord());
    expect(localStorage.getItem(key)).toBeNull();

    await act(async () => resolveCreate?.(makeSession({ id: "sess-late" })));
    await flush();

    expect(result.current.sessionId).toBeNull();
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("does not recreate a discarded local record during unmount cleanup", async () => {
    const key = "crossword:wedding-mini-v1:session";
    const { result, unmount } = renderHook(() =>
      useSolveSession({
        puzzleId: "wedding-mini-v1",
        availableDifficulties: ["easy", "medium", "hard"],
        initiallyStarted: false,
        initialDifficulty: "easy",
      }),
    );

    act(() => result.current.start("easy"));
    await flush();
    expect(localStorage.getItem(key)).not.toBeNull();

    act(() => result.current.discardLocalRecord());
    expect(localStorage.getItem(key)).toBeNull();
    unmount();

    expect(localStorage.getItem(key)).toBeNull();
  });

  it("ignores reportDifficulty once the solve has completed", async () => {
    const { result } = renderHook(() =>
      useSolveSession({
        puzzleId: "wedding-mini-v1",
        availableDifficulties: ["easy", "medium", "hard"],
        initiallyStarted: false,
        initialDifficulty: "hard",
      }),
    );

    act(() => result.current.start("hard"));
    await flush();
    act(() => result.current.complete());
    await flush();
    await waitFor(() => expect(result.current.finished).toBe(true));

    // The record is frozen at the completed difficulty (hard).
    expect(result.current.recordedDifficulty).toBe("hard");
    const reportsBefore = reportedDifficulties().length;

    // Browsing easier clues after completing must not move the record or fire
    // a report: this pins the hook's finished-guard on its own, with no page
    // !solved gate in front of it.
    act(() => result.current.reportDifficulty("easy"));
    await flush();

    expect(result.current.recordedDifficulty).toBe("hard");
    expect(reportedDifficulties()).toHaveLength(reportsBefore);
    expect(reportedDifficulties()).not.toContain("easy");
  });

  it("never reports a lower elapsed than the last accepted value", async () => {
    // The clock derives elapsed from Date.now() deltas, so a system clock that
    // jumps backward (NTP correction, manual change) while the clock is running
    // computes a live stretch shorter than what the server already accepted. The
    // Math.max floor against lastSentElapsedRef keeps the report monotonic so the
    // server never rejects it for shrinking; this drives the clock backward
    // mid-run and pins it.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const start = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(start);

    const { result } = renderHook(() =>
      useSolveSession({
        puzzleId: "wedding-mini-v1",
        availableDifficulties: ["easy", "medium", "hard"],
        initiallyStarted: false,
        initialDifficulty: "easy",
      }),
    );

    act(() => result.current.start("easy"));
    await flush();

    // Run forward 60s while solving; the heartbeats report up to 60000ms, so
    // that becomes the last accepted value (the clock stays running, so its
    // anchor is unchanged).
    act(() => vi.advanceTimersByTime(60_000));
    await flush();
    const afterForward = reportedElapsed();
    expect(afterForward[afterForward.length - 1]).toBe(60_000);

    // The system clock jumps backward WITHOUT pausing, so the still-anchored
    // live stretch (now - anchor) goes negative and totalElapsed() drops below
    // 60000. The next heartbeat then fires a report off that lowered value.
    act(() => vi.setSystemTime(start - 10_000));
    act(() => vi.advanceTimersByTime(30_000));
    await flush();

    // The floor holds: no report ever drops below the last accepted value
    // (without Math.max the last report would be the lowered computed elapsed).
    const all = reportedElapsed();
    expect(Math.min(...all)).toBe(60_000);
    expect(all[all.length - 1]).toBe(60_000);
  });

  it("ignores reportDifficulty for an unreportable restore (initiallyFinished)", async () => {
    // A solve restored as finished with no honest time mounts finished even
    // though complete() never ran, so reportDifficulty must no-op from the
    // first render.
    const { result } = renderHook(() =>
      useSolveSession({
        puzzleId: "wedding-mini-v1",
        availableDifficulties: ["easy", "medium", "hard"],
        initiallyStarted: true,
        initialDifficulty: "medium",
        initiallyFinished: true,
      }),
    );

    expect(result.current.finished).toBe(true);

    act(() => result.current.reportDifficulty("easy"));
    await flush();

    expect(result.current.recordedDifficulty).toBe("medium");
    expect(reportedDifficulties()).not.toContain("easy");
  });
});
