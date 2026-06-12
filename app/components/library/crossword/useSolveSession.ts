// The solve clock and its backend telemetry (pkg/games), shared by every
// crossword puzzle page. The clock accumulates ACTIVE solving milliseconds
// only: it stops for the explicit pause button, the settings dialog, and the
// tab being hidden. Elapsed time is flushed to the backend on every pause, on
// difficulty switches, on completion, on a heartbeat while solving, and (via
// a keepalive fetch) when the page goes away, so abandoned sessions still
// carry approximate times.
//
// Everything here is best-effort from the solver's perspective: reports are
// serialized on a queue and failures are swallowed silently, because network
// trouble must never break solving or surface mid-game.

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/libraries/api";
import {
  createGameSession,
  flushGameSession,
  postLeaderboardEntry,
  updateGameSession,
} from "@/libraries/games-api";
import type { UpdateGameSessionPayload } from "@/types/generated/games";

import { Difficulty, easierDifficulty } from "./puzzle";
import { loadSessionRecord, saveSessionRecord } from "./session";

/** How often elapsed time is reported while actively solving. */
export const HEARTBEAT_MS = 30_000;

/** The backend's elapsed_ms sanity ceiling (24 hours of active solving). */
const MAX_ELAPSED_MS = 86_400_000;

interface UseSolveSessionOptions {
  puzzleId: string;
  /** Whether saved progress exists, i.e. the guest started in an earlier visit. */
  initiallyStarted: boolean;
  /** The difficulty in play at mount (from saved progress, or the default). */
  initialDifficulty: Difficulty;
  /**
   * Whether the solve is already finished at mount even without a completed
   * session record. A solve that predates session tracking (or whose session
   * record was cleared) has no honest time, so the clock must not run and no
   * report may be sent for it.
   */
  initiallyFinished?: boolean;
}

export interface SolveSession {
  /** Total accumulated active milliseconds, ticking while the clock runs. */
  elapsedMs: number;
  /** Whether the guest has started this solve (now or in an earlier visit). */
  started: boolean;
  /** Whether the clock is currently accumulating. */
  running: boolean;
  /** True only for the explicit pause-button pause (the overlay case). */
  paused: boolean;
  /** Whether the solve is finished (solved now, or in an earlier visit). */
  finished: boolean;
  /**
   * The difficulty the solve is recorded at: the easiest level used at any
   * point, preferring the server's value when it has responded.
   */
  recordedDifficulty: Difficulty;
  /** Whether this solve has been posted to the leaderboard. */
  posted: boolean;
  start: (difficulty: Difficulty) => void;
  pause: () => void;
  resume: () => void;
  /** Pause/resume around UI that interrupts solving (the settings dialog). */
  setUiPaused: (paused: boolean) => void;
  /** Record a mid-solve difficulty switch and flush it to the backend. */
  reportDifficulty: (difficulty: Difficulty) => void;
  /** Stop the clock for good and report the solve as completed. */
  complete: () => void;
  /**
   * Publish the solve to the leaderboard. Unlike the telemetry, this is a
   * user-initiated action, so failures throw (with an ApiError for server
   * rejections) for the dialog to display.
   */
  postToLeaderboard: (displayName: string) => Promise<void>;
}

export function useSolveSession({
  puzzleId,
  initiallyStarted,
  initialDifficulty,
  initiallyFinished = false,
}: UseSolveSessionOptions): SolveSession {
  // The persisted record is read once; from then on the refs are the source
  // of truth and persist() writes them back at every meaningful moment.
  const [initialRecord] = useState(() => loadSessionRecord(puzzleId));

  const sessionIdRef = useRef<string | null>(initialRecord?.id ?? null);
  const baseElapsedRef = useRef(initialRecord?.elapsedMs ?? 0);
  const runningSinceRef = useRef<number | null>(null);
  const lastSentElapsedRef = useRef(0);
  const completedRef = useRef(initialRecord?.completed ?? false);
  const finishedRef = useRef(
    (initialRecord?.completed ?? false) || initiallyFinished,
  );
  const startedRef = useRef(initiallyStarted);
  const easiestRef = useRef<Difficulty>(
    initialRecord?.difficulty ?? initialDifficulty,
  );
  const postedNameRef = useRef(initialRecord?.postedName);
  // Reports are serialized so a heartbeat can never overtake a completion.
  const queueRef = useRef<Promise<void>>(Promise.resolve());

  const [started, setStarted] = useState(initiallyStarted);
  const [finished, setFinished] = useState(
    (initialRecord?.completed ?? false) || initiallyFinished,
  );
  const [paused, setPaused] = useState(false);
  const [uiPaused, setUiPausedState] = useState(false);
  // Read the real visibility at mount: a page opened in a background tab
  // (cmd+click, session restore) must not accrue active time before its
  // first focus.
  const [hidden, setHidden] = useState(
    () => document.visibilityState === "hidden",
  );
  const [elapsedMs, setElapsedMs] = useState(initialRecord?.elapsedMs ?? 0);
  const [recordedDifficulty, setRecordedDifficulty] = useState<Difficulty>(
    initialRecord?.difficulty ?? initialDifficulty,
  );
  const [posted, setPosted] = useState(Boolean(initialRecord?.postedName));

  /** Total accumulated active milliseconds as of right now. */
  const totalElapsed = useCallback(() => {
    const runningFor =
      runningSinceRef.current === null
        ? 0
        : Date.now() - runningSinceRef.current;
    return baseElapsedRef.current + runningFor;
  }, []);

  const persist = useCallback(() => {
    saveSessionRecord(puzzleId, {
      id: sessionIdRef.current,
      elapsedMs: totalElapsed(),
      completed: completedRef.current,
      difficulty: easiestRef.current,
      postedName: postedNameRef.current,
    });
  }, [puzzleId, totalElapsed]);

  // The server records the easiest difficulty seen across DELIVERED reports;
  // locally we also fold in switches that may not have reached it yet, so
  // the recorded difficulty is the min of both views.
  const applyServerDifficulty = useCallback((difficulty: Difficulty) => {
    easiestRef.current = easierDifficulty(easiestRef.current, difficulty);
    setRecordedDifficulty(easiestRef.current);
  }, []);

  const ensureSessionId = useCallback(async (): Promise<string | null> => {
    if (sessionIdRef.current) {
      return sessionIdRef.current;
    }
    try {
      const session = await createGameSession({
        puzzle_id: puzzleId,
        difficulty: easiestRef.current,
      });
      sessionIdRef.current = session.id;
      applyServerDifficulty(session.difficulty);
      persist();
      return session.id;
    } catch {
      // Couldn't create a session (offline, server trouble). Solving goes
      // on; the next report tries again.
      return null;
    }
  }, [puzzleId, applyServerDifficulty, persist]);

  /**
   * Report progress to the backend. Never throws: every failure mode either
   * self-heals (404 recreates the session, then one retry) or is dropped for
   * the next report to pick up.
   */
  const sendReport = useCallback(
    async (options: { completed?: boolean } = {}): Promise<void> => {
      if (!startedRef.current || completedRef.current) {
        return;
      }
      const id = await ensureSessionId();
      if (!id) {
        return;
      }
      // Elapsed may only grow server-side; clamp to the last accepted value
      // and the backend's ceiling so a report can never be rejected for
      // shrinking or overflowing.
      const elapsed = Math.min(
        Math.max(Math.round(totalElapsed()), lastSentElapsedRef.current),
        MAX_ELAPSED_MS,
      );
      // Every payload carries the easiest difficulty used so far: the server
      // folds min() across delivered reports, so resending the easiest keeps
      // it converging even when an earlier easy report was lost.
      const payload: UpdateGameSessionPayload = {
        elapsed_ms: elapsed,
        difficulty: easiestRef.current,
        completed: options.completed === true,
      };
      const applyResponse = (session: { difficulty: Difficulty }) => {
        lastSentElapsedRef.current = elapsed;
        applyServerDifficulty(session.difficulty);
        if (payload.completed) {
          completedRef.current = true;
        }
        persist();
      };
      try {
        applyResponse(await updateGameSession(id, payload));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // The stored session is gone server-side; recreate and retry once.
          sessionIdRef.current = null;
          const newId = await ensureSessionId();
          if (newId) {
            try {
              applyResponse(await updateGameSession(newId, payload));
            } catch {
              // Still failing; the next report retries.
            }
          }
        } else if (err instanceof ApiError && err.status === 409) {
          // The server already considers this session final: stop reporting.
          completedRef.current = true;
          persist();
        }
        // Anything else (network trouble, an elapsed race) is dropped
        // silently; telemetry must never break solving.
      }
    },
    [ensureSessionId, totalElapsed, applyServerDifficulty, persist],
  );

  const enqueue = useCallback((task: () => Promise<unknown>) => {
    queueRef.current = queueRef.current.then(() =>
      task().then(
        () => undefined,
        () => undefined,
      ),
    );
  }, []);

  const running = started && !finished && !paused && !uiPaused && !hidden;

  // The clock: while running, runningSince anchors the live stretch and a
  // once-a-second tick refreshes the readout; when it stops (pause, hide,
  // finish, unmount), the stretch folds into the base and persists.
  useEffect(() => {
    if (!running) {
      return;
    }
    runningSinceRef.current = Date.now();
    const interval = setInterval(() => setElapsedMs(totalElapsed()), 1000);
    return () => {
      clearInterval(interval);
      baseElapsedRef.current = totalElapsed();
      runningSinceRef.current = null;
      setElapsedMs(baseElapsedRef.current);
      persist();
    };
  }, [running, totalElapsed, persist]);

  // The heartbeat: report elapsed periodically while actively solving so an
  // abandoned session still holds an approximate time.
  useEffect(() => {
    if (!running) {
      return;
    }
    const interval = setInterval(() => {
      enqueue(() => sendReport());
    }, HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [running, enqueue, sendReport]);

  // Flush for the page going away. A keepalive fetch survives navigation
  // where the queued reports would be aborted.
  const flushOnHide = useCallback(() => {
    if (!startedRef.current || finishedRef.current || completedRef.current) {
      return;
    }
    // Persist only live solves. A finished solve already persisted its final
    // state when the clock stopped, and writing a record for a visit that
    // never started, or for an unreportable restore (initiallyFinished),
    // would mint the very session record whose absence marks the solve as
    // having no honest time.
    persist();
    const id = sessionIdRef.current;
    if (!id) {
      return;
    }
    const elapsed = Math.min(
      Math.max(Math.round(totalElapsed()), lastSentElapsedRef.current),
      MAX_ELAPSED_MS,
    );
    lastSentElapsedRef.current = elapsed;
    flushGameSession(id, {
      elapsed_ms: elapsed,
      difficulty: easiestRef.current,
      completed: false,
    });
  }, [persist, totalElapsed]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushOnHide();
        setHidden(true);
      } else {
        setHidden(false);
      }
    };
    const handlePageHide = () => flushOnHide();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      // In-SPA navigation away unmounts the page with no pagehide or
      // visibilitychange, so flush here too; otherwise the server stays up
      // to a heartbeat interval stale forever if the guest never returns.
      // The clock effect is declared earlier, so its cleanup has already
      // folded the live stretch into the base when this runs.
      flushOnHide();
    };
  }, [flushOnHide]);

  const start = useCallback(
    (difficulty: Difficulty) => {
      if (startedRef.current) {
        return;
      }
      startedRef.current = true;
      easiestRef.current = difficulty;
      setRecordedDifficulty(difficulty);
      setStarted(true);
      persist();
      enqueue(ensureSessionId);
    },
    [persist, enqueue, ensureSessionId],
  );

  const pause = useCallback(() => {
    if (!startedRef.current || finishedRef.current) {
      return;
    }
    setPaused(true);
    enqueue(() => sendReport());
  }, [enqueue, sendReport]);

  const resume = useCallback(() => {
    setPaused(false);
  }, []);

  const setUiPaused = useCallback(
    (value: boolean) => {
      setUiPausedState(value);
      if (value && startedRef.current && !finishedRef.current) {
        enqueue(() => sendReport());
      }
    },
    [enqueue, sendReport],
  );

  const reportDifficulty = useCallback(
    (difficulty: Difficulty) => {
      easiestRef.current = easierDifficulty(easiestRef.current, difficulty);
      setRecordedDifficulty(easiestRef.current);
      persist();
      if (startedRef.current && !finishedRef.current) {
        enqueue(() => sendReport());
      }
    },
    [persist, enqueue, sendReport],
  );

  const complete = useCallback(() => {
    if (finishedRef.current) {
      return;
    }
    finishedRef.current = true;
    setFinished(true);
    enqueue(() => sendReport({ completed: true }));
  }, [enqueue, sendReport]);

  const postToLeaderboard = useCallback(
    async (displayName: string) => {
      // Let in-flight reports settle, then make sure the completion actually
      // landed: posting is the one moment the guest cares about a report.
      await queueRef.current;
      if (!completedRef.current) {
        await sendReport({ completed: true });
      }
      const id = sessionIdRef.current;
      if (!completedRef.current || !id) {
        throw new Error(
          "We couldn't reach the server to record your solve. Please try again.",
        );
      }
      await postLeaderboardEntry(id, { display_name: displayName });
      postedNameRef.current = displayName;
      setPosted(true);
      persist();
    },
    [sendReport, persist],
  );

  return {
    elapsedMs,
    started,
    running,
    paused,
    finished,
    recordedDifficulty,
    posted,
    start,
    pause,
    resume,
    setUiPaused,
    reportDifficulty,
    complete,
    postToLeaderboard,
  };
}
