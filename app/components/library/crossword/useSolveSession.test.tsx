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

import type { PuzzleDifficulties } from "./puzzle";
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
    square_checks: 0,
    word_checks: 0,
    grid_checks: 0,
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
            square_checks: body.square_checks ?? 0,
            word_checks: body.word_checks ?? 0,
            grid_checks: body.grid_checks ?? 0,
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

  it("records cumulative check totals by scope", async () => {
    const key = "crossword:wedding-mini-v1:session";
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
    act(() => result.current.recordCheck("square"));
    await flush();
    act(() => {
      result.current.recordCheck("word");
      result.current.recordCheck("word");
      result.current.recordCheck("grid");
    });
    await flush();

    const reports = apiRequest.mock.calls
      .filter(
        ([path, options]) =>
          typeof path === "string" &&
          path.startsWith("/games/sessions/") &&
          options?.method === "PATCH",
      )
      .map(([, options]) => options?.body as UpdateGameSessionPayload);
    expect(reports[reports.length - 1]).toMatchObject({
      square_checks: 1,
      word_checks: 2,
      grid_checks: 1,
    });
    expect(JSON.parse(localStorage.getItem(key) ?? "null")).toMatchObject({
      squareChecks: 1,
      wordChecks: 2,
      gridChecks: 1,
    });
  });

  it("ignores checks once the solve has completed", async () => {
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
    act(() => result.current.recordCheck("square"));
    await flush();
    act(() => result.current.complete());
    await flush();
    const reportsBefore = apiRequest.mock.calls.length;

    act(() => result.current.recordCheck("grid"));
    await flush();

    expect(apiRequest.mock.calls).toHaveLength(reportsBefore);
    expect(
      JSON.parse(
        localStorage.getItem("crossword:wedding-mini-v1:session") ?? "null",
      ),
    ).toMatchObject({ squareChecks: 1, wordChecks: 0, gridChecks: 0 });
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

  describe("sibling tabs on one session", () => {
    // Two tabs of the same puzzle share one stored session record. Each tab
    // reads it at mount, so without reconciliation a tab opened early resumes
    // from its stale total and the server's max() records the longer tab's
    // time instead of the sum.
    function renderTab(
      availableDifficulties: PuzzleDifficulties = ["easy", "medium", "hard"],
    ) {
      return renderHook(() =>
        useSolveSession({
          puzzleId: "wedding-mini-v1",
          availableDifficulties,
          initiallyStarted: true,
          initialDifficulty: "easy",
          initiallyPaused: true,
        }),
      );
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      localStorage.setItem(
        "crossword:wedding-mini-v1:session",
        JSON.stringify({
          id: "sess-1",
          elapsedMs: 0,
          completed: false,
          difficulty: "easy",
        }),
      );
    });

    it("resumes from the time another tab accumulated since this one loaded", async () => {
      const tabA = renderTab();
      const tabB = renderTab();

      act(() => tabA.result.current.resume());
      act(() => vi.advanceTimersByTime(100_000));
      act(() => tabA.result.current.pause());
      await flush();

      act(() => tabB.result.current.resume());
      expect(tabB.result.current.elapsedMs).toBe(100_000);
      act(() => vi.advanceTimersByTime(30_000));
      act(() => tabB.result.current.complete());
      await flush();

      const all = reportedElapsed();
      expect(all[all.length - 1]).toBe(130_000);
    });

    it("never lowers the stored total when a stale tab persists", async () => {
      const tabA = renderTab();
      const tabB = renderTab();

      act(() => tabA.result.current.resume());
      act(() => vi.advanceTimersByTime(100_000));
      act(() => tabA.result.current.pause());
      await flush();

      // The stale tab closing persists its own (lower) total on the way out.
      tabB.unmount();

      const stored = JSON.parse(
        localStorage.getItem("crossword:wedding-mini-v1:session") ?? "{}",
      ) as { elapsedMs: number };
      expect(stored.elapsedMs).toBe(100_000);
    });

    it("never un-finishes or un-posts a solve another tab completed", async () => {
      const tabA = renderTab();
      const tabB = renderTab();

      act(() => tabA.result.current.resume());
      act(() => vi.advanceTimersByTime(60_000));
      act(() => tabA.result.current.recordCheck("word"));
      act(() => tabA.result.current.complete());
      await flush();
      apiRequest.mockResolvedValue(
        makeSession({ display_name: "Robin", on_leaderboard: true }),
      );
      await act(() => tabA.result.current.postToLeaderboard("Robin"));

      // The stale tab still believes the solve is in progress, unposted, and
      // unchecked; closing it must not write that back over tab A's record.
      tabB.unmount();

      const stored = JSON.parse(
        localStorage.getItem("crossword:wedding-mini-v1:session") ?? "{}",
      ) as Record<string, unknown>;
      expect(stored).toMatchObject({
        id: "sess-1",
        elapsedMs: 60_000,
        completed: true,
        postedName: "Robin",
        wordChecks: 1,
      });
    });

    /** Answer PATCHes the way pkg/games UpdateSession does for a frozen row. */
    function mockStrictServer() {
      let frozenElapsed: number | null = null;
      const conflicts: number[] = [];
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string; body?: unknown }) => {
          if (options?.method === "PATCH") {
            const body = options.body as UpdateGameSessionPayload;
            const elapsed = body.elapsed_ms ?? 0;
            if (
              frozenElapsed !== null &&
              (!body.completed || elapsed > frozenElapsed)
            ) {
              conflicts.push(elapsed);
              return Promise.reject(new ApiError(409, "completed"));
            }
            if (body.completed && frozenElapsed === null) {
              frozenElapsed = elapsed;
            }
            return Promise.resolve(
              makeSession({ difficulty: body.difficulty ?? "easy" }),
            );
          }
          if (path.includes("leaderboard")) {
            return Promise.resolve(makeSession({ display_name: "Robin" }));
          }
          return Promise.reject(new Error(`unexpected ${path}`));
        },
      );
      return conflicts;
    }

    function storedRecord() {
      return JSON.parse(
        localStorage.getItem("crossword:wedding-mini-v1:session") ?? "{}",
      ) as Record<string, unknown>;
    }

    it("takes a sibling's final time when finishing after it completed", async () => {
      const conflicts = mockStrictServer();
      const tabA = renderTab();
      const tabB = renderTab();

      act(() => tabA.result.current.resume());
      act(() => tabB.result.current.resume());
      act(() => vi.advanceTimersByTime(10_000));
      act(() => tabA.result.current.complete());
      await flush();

      // Tab B is still running and finishes on its own a moment later. The
      // server froze the row, so reporting would only earn a 409.
      act(() => vi.advanceTimersByTime(2_000));
      act(() => tabB.result.current.complete());
      await flush();

      expect(conflicts).toEqual([]);
      expect(tabB.result.current.elapsedMs).toBe(10_000);
      expect(tabB.result.current.postable).toBe(true);
      expect(storedRecord()).toMatchObject({
        elapsedMs: 10_000,
        completed: true,
      });
      expect(storedRecord().difficultyUnverified).toBeUndefined();

      await act(() => tabB.result.current.postToLeaderboard("Robin"));
      expect(tabB.result.current.posted).toBe(true);
    });

    it("does not start the clock on a solve a sibling already completed", async () => {
      const conflicts = mockStrictServer();
      const tabA = renderTab();
      const tabB = renderTab();

      act(() => tabA.result.current.resume());
      act(() => vi.advanceTimersByTime(60_000));
      act(() => tabA.result.current.complete());
      await flush();

      act(() => tabB.result.current.resume());
      await flush();
      expect(tabB.result.current.finished).toBe(true);
      expect(tabB.result.current.running).toBe(false);
      expect(tabB.result.current.elapsedMs).toBe(60_000);

      act(() => vi.advanceTimersByTime(90_000));
      await flush();
      expect(conflicts).toEqual([]);
      expect(storedRecord()).toMatchObject({ elapsedMs: 60_000 });
    });

    it("stops a running tab at its heartbeat once a sibling completed", async () => {
      const conflicts = mockStrictServer();
      const tabA = renderTab();
      const tabB = renderTab();

      act(() => tabA.result.current.resume());
      act(() => tabB.result.current.resume());
      act(() => vi.advanceTimersByTime(10_000));
      act(() => tabA.result.current.complete());
      await flush();

      act(() => vi.advanceTimersByTime(30_000));
      await flush();
      expect(conflicts).toEqual([]);
      expect(tabB.result.current.finished).toBe(true);
      expect(tabB.result.current.postable).toBe(true);
      expect(storedRecord()).toMatchObject({ elapsedMs: 10_000 });

      // Closing it afterward leaves the final time alone too.
      tabB.unmount();
      expect(storedRecord()).toMatchObject({ elapsedMs: 10_000 });
    });

    it("keeps a completed solve's difficulty when a stale tab closes", async () => {
      localStorage.setItem(
        "crossword:wedding-mini-v1:session",
        JSON.stringify({
          id: "sess-1",
          elapsedMs: 0,
          completed: false,
          difficulty: "hard",
        }),
      );
      const tabA = renderTab();
      const tabB = renderTab();

      act(() => tabA.result.current.resume());
      act(() => tabA.result.current.reportDifficulty("easy"));
      act(() => tabA.result.current.complete());
      await flush();
      tabB.unmount();

      expect(storedRecord()).toMatchObject({
        completed: true,
        difficulty: "easy",
      });
      expect(renderTab().result.current.recordedDifficulty).toBe("easy");
    });

    it("carries a sibling's easier difficulty when the server never heard it", async () => {
      localStorage.setItem(
        "crossword:wedding-mini-v1:session",
        JSON.stringify({
          id: "sess-1",
          elapsedMs: 0,
          completed: false,
          difficulty: "hard",
        }),
      );
      const tabA = renderTab();
      const tabB = renderTab();

      // Tab A's easy switch never reaches the server.
      apiRequest.mockRejectedValueOnce(new Error("offline"));
      act(() => tabA.result.current.reportDifficulty("easy"));
      await flush();
      tabA.unmount();
      mockApi();

      act(() => tabB.result.current.resume());
      act(() => tabB.result.current.pause());
      await flush();

      const difficulties = reportedDifficulties();
      expect(difficulties[difficulties.length - 1]).toBe("easy");
      expect(tabB.result.current.recordedDifficulty).toBe("easy");
      expect(storedRecord()).toMatchObject({ difficulty: "easy" });
    });

    it("keeps every check count a sibling stored", async () => {
      const tabA = renderTab();
      const tabB = renderTab();

      act(() => tabA.result.current.recordCheck("square"));
      act(() => tabA.result.current.recordCheck("word"));
      act(() => tabA.result.current.recordCheck("grid"));
      await flush();
      tabB.unmount();

      expect(storedRecord()).toMatchObject({
        squareChecks: 1,
        wordChecks: 1,
        gridChecks: 1,
      });
    });

    function seedRecord(record: Record<string, unknown>) {
      localStorage.setItem(
        "crossword:wedding-mini-v1:session",
        JSON.stringify({
          id: "sess-1",
          elapsedMs: 0,
          completed: false,
          difficulty: "easy",
          ...record,
        }),
      );
    }

    it("carries a sibling's time and checks into a completion report", async () => {
      const tabA = renderTab();
      const tabB = renderTab();
      act(() => tabB.result.current.resume());

      // Everything tab A reports is lost, so only the stored record has it.
      act(() => tabA.result.current.resume());
      apiRequest.mockRejectedValue(new Error("offline"));
      act(() => vi.advanceTimersByTime(29_000));
      act(() => tabA.result.current.recordCheck("grid"));
      act(() => tabA.result.current.pause());
      await flush();
      tabA.unmount();

      apiRequest.mockReset();
      mockApi();
      act(() => tabB.result.current.complete());
      await flush();

      const patches = apiRequest.mock.calls.filter(
        ([, options]) => options?.method === "PATCH",
      );
      expect(patches[patches.length - 1][1].body).toMatchObject({
        elapsed_ms: 29_000,
        grid_checks: 1,
        completed: true,
      });
    });

    it("shows the server's final time when it is ahead of this tab", async () => {
      apiRequest.mockImplementation(
        (_path: string, options?: { body?: unknown }) =>
          Promise.resolve(
            makeSession({
              elapsed_ms: 100_000,
              difficulty:
                (options?.body as UpdateGameSessionPayload | undefined)
                  ?.difficulty ?? "easy",
            }),
          ),
      );
      const tab = renderTab();
      act(() => tab.result.current.resume());
      act(() => vi.advanceTimersByTime(60_000));
      act(() => tab.result.current.complete());
      await flush();

      expect(tab.result.current.elapsedMs).toBe(100_000);
      expect(storedRecord()).toMatchObject({ elapsedMs: 100_000 });
    });

    it("does not let a sibling's late difficulty move a completed solve", async () => {
      seedRecord({ difficulty: "hard" });
      const tab = renderTab();
      // The sibling's easy switch lands while the completion is in flight, so
      // the row froze at hard without ever hearing about it.
      apiRequest.mockImplementation(() => {
        seedRecord({ difficulty: "easy" });
        return Promise.resolve(makeSession({ difficulty: "hard" }));
      });
      act(() => tab.result.current.resume());
      act(() => tab.result.current.complete());
      await flush();

      expect(tab.result.current.recordedDifficulty).toBe("hard");
      expect(storedRecord()).toMatchObject({
        completed: true,
        difficulty: "hard",
      });
    });

    it("stays postable adopting a verified solve while reconciling a legacy record", async () => {
      seedRecord({ difficulty: "easy" });
      const tabA = renderTab(["medium", "hard"]);
      const tabB = renderTab(["medium", "hard"]);
      expect(tabB.result.current.postable).toBe(false);

      act(() => tabA.result.current.resume());
      act(() => tabA.result.current.complete());
      await flush();
      expect(tabA.result.current.postable).toBe(true);

      act(() => tabB.result.current.resume());
      await flush();
      expect(tabB.result.current.finished).toBe(true);
      expect(tabB.result.current.postable).toBe(true);
      expect(tabB.result.current.recordedDifficulty).toBe("medium");
      expect(storedRecord().difficultyUnverified).toBeUndefined();
    });

    it("never reports a stored difficulty the puzzle no longer offers", async () => {
      seedRecord({ difficulty: "easy" });
      const tab = renderTab(["medium", "hard"]);

      act(() => tab.result.current.resume());
      act(() => tab.result.current.pause());
      await flush();
      act(() => tab.result.current.resume());
      act(() => tab.result.current.pause());
      await flush();

      expect(reportedDifficulties().length).toBeGreaterThan(1);
      expect(reportedDifficulties()).not.toContain("easy");
      expect(tab.result.current.recordedDifficulty).toBe("medium");
    });

    it("ignores a sibling's unverified difficulty", async () => {
      seedRecord({ difficulty: "hard" });
      const tab = renderTab();
      seedRecord({ difficulty: "easy", difficultyUnverified: true });

      act(() => tab.result.current.resume());
      act(() => tab.result.current.pause());
      await flush();

      expect(reportedDifficulties()).not.toContain("easy");
    });

    it("adopts a sibling's final state, posted name included", async () => {
      const tab = renderTab();
      seedRecord({
        elapsedMs: 75_000,
        completed: true,
        difficulty: "medium",
        postedName: "Robin",
        gridChecks: 2,
      });

      act(() => tab.result.current.resume());
      await flush();

      expect(tab.result.current.posted).toBe(true);
      expect(tab.result.current.recordedDifficulty).toBe("medium");
      apiRequest.mockResolvedValue(makeSession());
      await act(() => tab.result.current.renameLeaderboardEntry("Robin J"));
      expect(storedRecord()).toMatchObject({
        postedName: "Robin J",
        elapsedMs: 75_000,
        gridChecks: 2,
      });
    });

    it("refuses to post when the report reveals an unverified solve", async () => {
      const tab = renderTab();
      seedRecord({ completed: true, difficultyUnverified: true });
      apiRequest.mockClear();

      await act(async () => {
        await expect(
          tab.result.current.postToLeaderboard("Robin"),
        ).rejects.toThrow(/can't be posted/);
      });
      expect(apiRequest).not.toHaveBeenCalled();
    });

    it("adopts a sibling's completion when a report loses the race to it", async () => {
      const tab = renderTab();
      apiRequest.mockImplementation(() => {
        seedRecord({ elapsedMs: 40_000, completed: true });
        return Promise.reject(new ApiError(409, "completed"));
      });

      act(() => tab.result.current.reportDifficulty("easy"));
      await flush();

      expect(tab.result.current.finished).toBe(true);
      expect(tab.result.current.postable).toBe(true);
      expect(tab.result.current.elapsedMs).toBe(40_000);
      expect(storedRecord().difficultyUnverified).toBeUndefined();
    });

    it("drops out of the pause state when a pause finds the solve completed", async () => {
      const tab = renderTab();
      act(() => tab.result.current.resume());
      seedRecord({ elapsedMs: 40_000, completed: true });

      act(() => tab.result.current.pause());
      await flush();

      expect(tab.result.current.finished).toBe(true);
      expect(tab.result.current.paused).toBe(false);
    });

    it("sends no flush for a solve a sibling completed when hiding", async () => {
      const conflicts = mockStrictServer();
      const tabA = renderTab();
      const tabB = renderTab();
      act(() => tabA.result.current.complete());
      await flush();
      apiRequest.mockClear();

      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      await flush();

      expect(conflicts).toEqual([]);
      expect(apiRequest).not.toHaveBeenCalled();
      expect(tabB.result.current.finished).toBe(true);
    });

    it("joins a session stored after this tab loaded instead of minting one", async () => {
      localStorage.clear();
      const idle = renderHook(() =>
        useSolveSession({
          puzzleId: "wedding-mini-v1",
          availableDifficulties: ["easy", "medium", "hard"],
          initiallyStarted: false,
          initialDifficulty: "easy",
        }),
      );
      seedRecord({
        elapsedMs: 90_000,
        completed: true,
        postedName: "Robin",
      });

      act(() => idle.result.current.start("hard"));
      await flush();

      expect(apiRequest).not.toHaveBeenCalled();
      expect(idle.result.current.finished).toBe(true);
      expect(storedRecord()).toMatchObject({
        id: "sess-1",
        elapsedMs: 90_000,
        completed: true,
        postedName: "Robin",
      });
    });

    it("shares one session between tabs that loaded before it existed", async () => {
      seedRecord({ id: null });
      const tabA = renderTab();
      const tabB = renderTab();

      act(() => tabB.result.current.resume());
      act(() => vi.advanceTimersByTime(20_000));
      act(() => tabB.result.current.pause());
      await flush();
      expect(tabB.result.current.sessionId).toBe("sess-1");

      act(() => tabA.result.current.resume());
      await flush();
      expect(tabA.result.current.sessionId).toBe("sess-1");
      expect(tabA.result.current.elapsedMs).toBe(20_000);
      act(() => tabA.result.current.pause());
      await flush();

      const creates = apiRequest.mock.calls.filter(
        ([path, options]) =>
          path === "/games/sessions" && options?.method === "POST",
      );
      expect(creates).toHaveLength(1);
    });

    it("keeps what an offline sibling stored when this tab gets the first id", async () => {
      seedRecord({ id: null });
      const tab = renderTab();
      seedRecord({ id: null, elapsedMs: 100_000, gridChecks: 3 });
      apiRequest.mockClear();

      act(() => tab.result.current.reportDifficulty("easy"));
      await flush();

      expect(storedRecord()).toMatchObject({
        id: "sess-1",
        elapsedMs: 100_000,
        gridChecks: 3,
      });
    });

    it("recreates a session the server lost rather than rejoining its dead id", async () => {
      const tab = renderTab();
      let created = 0;
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) => {
          if (options?.method === "POST") {
            created += 1;
            return Promise.resolve(makeSession({ id: "sess-2" }));
          }
          return path.endsWith("sess-1")
            ? Promise.reject(new ApiError(404, "gone"))
            : Promise.resolve(makeSession({ id: "sess-2" }));
        },
      );

      act(() => tab.result.current.reportDifficulty("easy"));
      await flush();
      await flush();

      expect(created).toBe(1);
      expect(tab.result.current.sessionId).toBe("sess-2");
      expect(storedRecord()).toMatchObject({ id: "sess-2" });
    });

    it("catches up when a dialog or tab switch restarts the clock", async () => {
      const tab = renderTab();
      act(() => tab.result.current.setUiPaused(true));
      seedRecord({ elapsedMs: 40_000 });
      act(() => tab.result.current.setUiPaused(false));
      expect(tab.result.current.elapsedMs).toBe(40_000);

      const visibility = vi.spyOn(document, "visibilityState", "get");
      visibility.mockReturnValue("hidden");
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      seedRecord({ elapsedMs: 80_000 });
      visibility.mockReturnValue("visible");
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      visibility.mockRestore();
      expect(tab.result.current.elapsedMs).toBe(80_000);
    });

    it("merges nothing from a stored record of a different session", async () => {
      const tab = renderTab();
      seedRecord({ id: "sess-other", elapsedMs: 500_000, gridChecks: 9 });

      act(() => tab.result.current.resume());
      await flush();
      expect(tab.result.current.elapsedMs).toBe(0);

      act(() => tab.result.current.pause());
      await flush();
      expect(storedRecord()).toMatchObject({
        id: "sess-1",
        elapsedMs: 0,
        gridChecks: 0,
      });
    });

    it("leaves a different session's completed record alone", async () => {
      const tab = renderTab();
      const other = {
        id: "sess-other",
        elapsedMs: 500_000,
        completed: true,
        postedName: "Someone",
      };
      seedRecord(other);

      act(() => tab.result.current.resume());
      await flush();
      expect(tab.result.current.finished).toBe(false);

      tab.unmount();
      expect(storedRecord()).toMatchObject(other);
    });

    it("keeps a completed record when a tab with no id closes", async () => {
      seedRecord({ id: null });
      const tab = renderTab();
      const final = {
        id: "sess-x",
        elapsedMs: 300_000,
        completed: true,
        postedName: "Robin",
      };
      seedRecord(final);
      apiRequest.mockClear();

      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      tab.unmount();

      expect(storedRecord()).toMatchObject(final);
      expect(apiRequest).not.toHaveBeenCalled();
    });

    it("joins the stored session on a check instead of minting one", async () => {
      seedRecord({ id: null });
      const tab = renderTab();
      seedRecord({ id: "sess-x", elapsedMs: 30_000 });

      act(() => tab.result.current.recordCheck("word"));
      await flush();

      expect(tab.result.current.sessionId).toBe("sess-x");
      expect(apiRequest).not.toHaveBeenCalledWith(
        "/games/sessions",
        expect.anything(),
      );
    });

    /** A server that lost sess-1, with a hook for what happens meanwhile. */
    function mockLostSession(hooks: {
      onLost?: () => void;
      onCreate?: () => void;
    }) {
      const patched: string[] = [];
      let created = 0;
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) => {
          if (options?.method === "POST") {
            created += 1;
            hooks.onCreate?.();
            return Promise.resolve(makeSession({ id: "sess-2" }));
          }
          patched.push(path);
          if (path.endsWith("sess-1")) {
            hooks.onLost?.();
            return Promise.reject(new ApiError(404, "gone"));
          }
          return Promise.resolve(makeSession({ id: "sess-2" }));
        },
      );
      return { patched, created: () => created };
    }

    async function drain() {
      for (let i = 0; i < 5; i += 1) {
        await flush();
      }
    }

    it("joins a session a sibling already recreated after a 404", async () => {
      const tab = renderTab();
      const server = mockLostSession({
        onLost: () => seedRecord({ id: "sess-2", elapsedMs: 5_000 }),
      });

      act(() => tab.result.current.reportDifficulty("easy"));
      await drain();

      expect(server.created()).toBe(0);
      expect(server.patched[server.patched.length - 1]).toMatch(/sess-2$/);
      expect(storedRecord()).toMatchObject({ id: "sess-2" });
    });

    it("keeps a sibling's time and checks through a 404", async () => {
      const tab = renderTab();
      mockLostSession({
        onLost: () => seedRecord({ elapsedMs: 90_000, gridChecks: 5 }),
      });

      act(() => tab.result.current.reportDifficulty("easy"));
      await drain();

      expect(storedRecord()).toMatchObject({
        id: "sess-2",
        elapsedMs: 90_000,
        gridChecks: 5,
      });
    });

    it("does not rejoin a dead session a stale sibling writes back", async () => {
      const tab = renderTab();
      const server = mockLostSession({
        onCreate: () => seedRecord({ id: "sess-1" }),
      });

      act(() => tab.result.current.reportDifficulty("easy"));
      await drain();

      expect(tab.result.current.sessionId).toBe("sess-2");
      expect(server.patched[server.patched.length - 1]).toMatch(/sess-2$/);
    });

    it("ignores a response that arrives after adopting a completion", async () => {
      const tab = renderTab();
      let respond: (session: GameSession) => void = () => undefined;
      apiRequest.mockImplementation(
        () =>
          new Promise((resolve) => {
            respond = resolve;
          }),
      );

      act(() => tab.result.current.reportDifficulty("easy"));
      await flush();
      seedRecord({ completed: true, difficultyUnverified: true });
      act(() => tab.result.current.setUiPaused(false));
      expect(tab.result.current.postable).toBe(false);

      await act(async () => {
        respond(makeSession());
        await Promise.resolve();
      });
      await flush();

      expect(tab.result.current.postable).toBe(false);
      expect(storedRecord().difficultyUnverified).toBe(true);
    });

    it("keeps a completed solve's difficulty if the start dialog returns", async () => {
      seedRecord({ completed: true, difficulty: "easy" });
      const { result } = renderHook(() =>
        useSolveSession({
          puzzleId: "wedding-mini-v1",
          availableDifficulties: ["easy", "medium", "hard"],
          initiallyStarted: false,
          initialDifficulty: "easy",
        }),
      );

      act(() => result.current.start("hard"));
      await flush();

      expect(result.current.recordedDifficulty).toBe("easy");
      expect(storedRecord()).toMatchObject({ difficulty: "easy" });
    });
  });

  describe("renameLeaderboardEntry", () => {
    function renderPosted() {
      localStorage.setItem(
        "crossword:wedding-mini-v1:session",
        JSON.stringify({
          id: "sess-posted",
          elapsedMs: 45_000,
          completed: true,
          difficulty: "easy",
          postedName: "Robin",
        }),
      );
      return renderHook(() =>
        useSolveSession({
          puzzleId: "wedding-mini-v1",
          availableDifficulties: ["easy", "medium", "hard"],
          initiallyStarted: true,
          initialDifficulty: "easy",
          initiallyPaused: true,
          initiallyFinished: true,
        }),
      );
    }

    it("re-posts the new name and remembers it locally", async () => {
      apiRequest.mockResolvedValue(
        makeSession({ id: "sess-posted", display_name: "Robin J" }),
      );
      const { result } = renderPosted();

      await act(() => result.current.renameLeaderboardEntry("Robin J"));

      expect(apiRequest).toHaveBeenCalledWith(
        "/games/sessions/sess-posted/leaderboard",
        expect.objectContaining({
          method: "POST",
          body: { display_name: "Robin J" },
        }),
      );
      const stored = JSON.parse(
        localStorage.getItem("crossword:wedding-mini-v1:session")!,
      );
      expect(stored.postedName).toBe("Robin J");
    });

    it("keeps a server rejection's own message", async () => {
      apiRequest.mockRejectedValue(
        new ApiError(422, "Name is too long.", "validation_error"),
      );
      const { result } = renderPosted();

      await expect(
        result.current.renameLeaderboardEntry("Robin J"),
      ).rejects.toThrow("Name is too long.");
    });

    it("replaces an uncoded server error with guest-facing copy", async () => {
      // A proxy error page has no API envelope, so the ApiError carries only
      // a generic "Request failed with status 502" message and no code.
      apiRequest.mockRejectedValue(
        new ApiError(502, "Request failed with status 502"),
      );
      const { result } = renderPosted();

      await expect(
        result.current.renameLeaderboardEntry("Robin J"),
      ).rejects.toThrow(
        "We couldn't reach the server to change your name. Please try again.",
      );
    });

    it("replaces a raw network failure with guest-facing copy", async () => {
      apiRequest.mockRejectedValue(new TypeError("Failed to fetch"));
      const { result } = renderPosted();

      await expect(
        result.current.renameLeaderboardEntry("Robin J"),
      ).rejects.toThrow(
        "We couldn't reach the server to change your name. Please try again.",
      );
    });
  });
});
