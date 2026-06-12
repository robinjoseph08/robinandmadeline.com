// Page-level tests for the crossword's solve clock and backend session: the
// timer and its pause surfaces, the telemetry reports (create, heartbeat,
// flushes, error recovery), completion, and the leaderboard flows. The grid
// interactions and settings live in Crossword.test.tsx. Everything runs
// against the mini; the full puzzle shares the same code path.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SolveSessionRecord } from "@/components/library/crossword/session";
import Crossword from "@/components/pages/Crossword";
import { ApiError } from "@/libraries/api";
import { GUEST_TOKEN_STORAGE_KEY } from "@/libraries/guest-api";
import type { UpdateGameSessionPayload } from "@/types/generated/games";
import type { GameSession } from "@/types/generated/models";

const apiRequest = vi.fn();
vi.mock("@/libraries/api", async () => {
  const actual = await vi.importActual<object>("@/libraries/api");
  return {
    ...actual,
    apiRequest: (...args: unknown[]) => apiRequest(...args),
  };
});

const PROGRESS_KEY = "crossword:wedding-mini-v1:progress";
const SESSION_KEY = "crossword:wedding-mini-v1:session";
const SOLUTION = ".KISSDANCEAPNEASPENTHARE.";
const EMPTY_ENTRIES = SOLUTION.replace(/[A-Z]/g, "?");
const ALL_BUT_LAST = `${SOLUTION.slice(0, 23)}?.`;

function makeSession(overrides: Partial<GameSession> = {}): GameSession {
  return {
    id: "sess-1",
    puzzle_id: "wedding-mini-v1",
    party_id: undefined,
    difficulty: "easy",
    elapsed_ms: 0,
    completed_at: undefined,
    display_name: undefined,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Default happy-path API: session create/update succeed, leaderboard empty. */
function mockApiRoutes() {
  apiRequest.mockImplementation(
    (path: string, options?: { method?: string; body?: unknown }) => {
      const method = options?.method ?? "GET";
      if (path === "/games/sessions" && method === "POST") {
        const body = options?.body as { difficulty: GameSession["difficulty"] };
        return Promise.resolve(makeSession({ difficulty: body.difficulty }));
      }
      if (path.startsWith("/games/sessions/") && method === "PATCH") {
        const body = options?.body as {
          difficulty?: GameSession["difficulty"];
          elapsed_ms?: number;
        };
        return Promise.resolve(
          makeSession({
            difficulty: body.difficulty ?? "easy",
            elapsed_ms: body.elapsed_ms ?? 0,
          }),
        );
      }
      if (path.startsWith("/games/leaderboard")) {
        return Promise.resolve({ items: [], total: 0 });
      }
      return Promise.reject(new Error(`unexpected request: ${method} ${path}`));
    },
  );
}

function seedProgress(entries: string, difficulty = "easy") {
  localStorage.setItem(PROGRESS_KEY, JSON.stringify({ entries, difficulty }));
}

function seedSession(record: Partial<SolveSessionRecord>) {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      id: "sess-1",
      elapsedMs: 0,
      completed: false,
      difficulty: "easy",
      ...record,
    }),
  );
}

function storedSession(): SolveSessionRecord {
  return JSON.parse(localStorage.getItem(SESSION_KEY)!) as SolveSessionRecord;
}

function renderCrossword(slug = "mini") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/games/crossword/${slug}`]}>
        <Routes>
          <Route Component={Crossword} path="/games/crossword/:puzzleSlug" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function startGame() {
  fireEvent.click(screen.getByRole("button", { name: "Start solving" }));
  await flushAsync();
}

/** Drain queued telemetry promises (several chained microtask ticks). */
async function flushAsync() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {});
  }
}

/** Advance fake timers inside act and settle the reports they queued. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await flushAsync();
}

function useFakeClock() {
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
}

function gridEl() {
  return screen.getByRole("application", { name: /crossword grid/i });
}

function square(row: number, col: number) {
  return screen.getByTestId(`crossword-square-${row}-${col}`);
}

function timer() {
  return screen.getByTestId("crossword-timer");
}

function patchBodies(): UpdateGameSessionPayload[] {
  return apiRequest.mock.calls
    .filter(
      ([, options]) => (options as { method?: string })?.method === "PATCH",
    )
    .map(([, options]) => (options as { body: UpdateGameSessionPayload }).body);
}

function lastPatchBody(): UpdateGameSessionPayload {
  const bodies = patchBodies();
  expect(bodies.length).toBeGreaterThan(0);
  return bodies[bodies.length - 1];
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** Solve the last letter of an ALL_BUT_LAST grid. */
async function solveLastLetter() {
  fireEvent.mouseDown(square(4, 3));
  fireEvent.keyDown(gridEl(), { key: "E" });
  await flushAsync();
}

describe("Crossword solve sessions", () => {
  beforeEach(() => {
    localStorage.clear();
    apiRequest.mockReset();
    mockApiRoutes();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, "visibilityState");
  });

  describe("session lifecycle", () => {
    it("creates a session on start and persists its id beside the progress", async () => {
      renderCrossword();
      await startGame();

      const creates = apiRequest.mock.calls.filter(
        ([path, options]) =>
          path === "/games/sessions" &&
          (options as { method?: string })?.method === "POST",
      );
      expect(creates).toHaveLength(1);
      expect(creates[0][1]).toMatchObject({
        body: { puzzle_id: "wedding-mini-v1", difficulty: "easy" },
      });
      expect(storedSession()).toMatchObject({ id: "sess-1", completed: false });
    });

    it("reuses the saved session for a returning guest and keeps accumulating", async () => {
      seedProgress(EMPTY_ENTRIES);
      seedSession({ id: "sess-9", elapsedMs: 60_000 });
      useFakeClock();

      renderCrossword();
      expect(timer()).toHaveTextContent("1:00");

      await advance(30_000);

      // No new session: the heartbeat reports against the stored one, with
      // the TOTAL accumulated time (old 60s plus this visit's 30s).
      expect(
        apiRequest.mock.calls.some(([path]) => path === "/games/sessions"),
      ).toBe(false);
      expect(apiRequest).toHaveBeenCalledWith(
        "/games/sessions/sess-9",
        expect.objectContaining({
          method: "PATCH",
          body: expect.objectContaining({
            elapsed_ms: 90_000,
            completed: false,
          }),
        }),
      );
      expect(timer()).toHaveTextContent("1:30");
    });

    it("recreates the session when the server has lost it", async () => {
      seedProgress(EMPTY_ENTRIES);
      seedSession({ id: "sess-gone" });
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string; body?: unknown }) => {
          const method = options?.method ?? "GET";
          if (path === "/games/sessions/sess-gone" && method === "PATCH") {
            return Promise.reject(new ApiError(404, "session not found"));
          }
          if (path === "/games/sessions" && method === "POST") {
            return Promise.resolve(makeSession({ id: "sess-2" }));
          }
          if (path === "/games/sessions/sess-2" && method === "PATCH") {
            return Promise.resolve(makeSession({ id: "sess-2" }));
          }
          return Promise.reject(new Error(`unexpected ${method} ${path}`));
        },
      );
      useFakeClock();

      renderCrossword();
      await advance(30_000);

      expect(apiRequest).toHaveBeenCalledWith(
        "/games/sessions",
        expect.objectContaining({ method: "POST" }),
      );
      expect(apiRequest).toHaveBeenCalledWith(
        "/games/sessions/sess-2",
        expect.objectContaining({ method: "PATCH" }),
      );
      expect(storedSession().id).toBe("sess-2");
    });

    it("stops reporting once the server says the session is final", async () => {
      seedProgress(EMPTY_ENTRIES);
      seedSession({ id: "sess-9" });
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) => {
          if (options?.method === "PATCH") {
            return Promise.reject(
              new ApiError(409, "session already completed"),
            );
          }
          return Promise.reject(new Error(`unexpected ${path}`));
        },
      );
      useFakeClock();

      renderCrossword();
      await advance(30_000);
      expect(patchBodies()).toHaveLength(1);

      await advance(30_000);
      expect(patchBodies()).toHaveLength(1);
      expect(storedSession().completed).toBe(true);
    });

    it("clears a stale guest token and retries anonymously on a 401", async () => {
      localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "stale.jwt");
      renderCrossword();
      apiRequest.mockImplementationOnce(() =>
        Promise.reject(new ApiError(401, "token expired")),
      );

      await startGame();

      const creates = apiRequest.mock.calls.filter(
        ([path]) => path === "/games/sessions",
      );
      expect(creates).toHaveLength(2);
      expect(creates[0][1]).toMatchObject({ token: "stale.jwt" });
      expect(creates[1][1]).toMatchObject({ token: null });
      expect(localStorage.getItem(GUEST_TOKEN_STORAGE_KEY)).toBeNull();
      expect(storedSession().id).toBe("sess-1");
    });

    it("never lets telemetry failures interrupt solving", async () => {
      apiRequest.mockImplementation(() =>
        Promise.reject(new TypeError("network down")),
      );

      renderCrossword();
      await startGame();

      fireEvent.mouseDown(square(0, 1));
      fireEvent.keyDown(gridEl(), { key: "K" });
      fireEvent.keyDown(gridEl(), { key: "I" });
      await flushAsync();

      expect(square(0, 1)).toHaveTextContent("K");
      expect(square(0, 2)).toHaveTextContent("I");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("timer and pause", () => {
    it("accumulates active time, pauses behind an obscuring overlay, and flushes on pause", async () => {
      useFakeClock();
      renderCrossword();
      await startGame();

      await advance(5_000);
      expect(timer()).toHaveTextContent("0:05");

      fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
      await flushAsync();

      // The pause flushed the TOTAL elapsed so far.
      expect(lastPatchBody()).toMatchObject({
        elapsed_ms: 5_000,
        completed: false,
      });
      // The grid is obscured and inert so the clock can't be gamed.
      const overlay = screen.getByTestId("crossword-grid-overlay");
      expect(square(0, 1).closest("[inert]")).not.toBeNull();
      // The clues are inert too: a paused solver must not be able to keep
      // reading the puzzle off the clock.
      expect(
        screen
          .getByRole("button", { name: /1\. Smooch shared at the altar/ })
          .closest("[inert]"),
      ).not.toBeNull();

      // Paused time does not count.
      await advance(4_000);
      expect(timer()).toHaveTextContent("0:05");

      fireEvent.click(within(overlay).getByRole("button", { name: "Resume" }));
      await advance(2_000);
      expect(timer()).toHaveTextContent("0:07");
    });

    it("pauses while the settings dialog is open and flushes on opening", async () => {
      useFakeClock();
      renderCrossword();
      await startGame();

      await advance(3_000);
      fireEvent.click(screen.getByRole("button", { name: "Settings" }));
      await flushAsync();

      expect(lastPatchBody()).toMatchObject({ elapsed_ms: 3_000 });

      // Time spent in the settings dialog does not count.
      await advance(5_000);
      const dialog = screen.getByTestId("crossword-settings-dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      await advance(2_000);

      expect(timer()).toHaveTextContent("0:05");
    });

    it("pauses while the leaderboard dialog is open and flushes on opening", async () => {
      useFakeClock();
      renderCrossword();
      await startGame();

      await advance(3_000);
      fireEvent.click(screen.getByRole("button", { name: /leaderboard/i }));
      await flushAsync();

      expect(lastPatchBody()).toMatchObject({ elapsed_ms: 3_000 });

      // Time spent reading the leaderboard does not count. The dialog has
      // two closers (the footer button and the X); either resumes the clock.
      await advance(5_000);
      const dialog = screen.getByTestId("crossword-leaderboard-dialog");
      fireEvent.click(
        within(dialog).getAllByRole("button", { name: "Close" })[0],
      );
      await advance(2_000);

      expect(timer()).toHaveTextContent("0:05");
    });

    it("pauses when the tab hides and flushes through a keepalive request", async () => {
      useFakeClock();
      renderCrossword();
      await startGame();

      await advance(4_000);
      setVisibility("hidden");
      await flushAsync();

      // The flush rides the regular apiRequest path with keepalive set so it
      // survives the page going away.
      expect(apiRequest).toHaveBeenCalledWith(
        "/games/sessions/sess-1",
        expect.objectContaining({
          method: "PATCH",
          keepalive: true,
          body: expect.objectContaining({
            elapsed_ms: 4_000,
            completed: false,
          }),
        }),
      );

      // Hidden time does not count; coming back resumes the clock.
      await advance(5_000);
      setVisibility("visible");
      await advance(1_000);
      expect(timer()).toHaveTextContent("0:05");
    });

    it("flushes through a keepalive request on pagehide", async () => {
      useFakeClock();
      renderCrossword();
      await startGame();

      await advance(4_000);
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      await flushAsync();

      expect(apiRequest).toHaveBeenCalledWith(
        "/games/sessions/sess-1",
        expect.objectContaining({
          method: "PATCH",
          keepalive: true,
          body: expect.objectContaining({
            elapsed_ms: 4_000,
            completed: false,
          }),
        }),
      );
    });

    it("flushes a report when the page unmounts mid-solve", async () => {
      // In-SPA navigation away fires no pagehide or visibilitychange; the
      // unmount itself must flush, or the server stays a heartbeat stale
      // forever when the guest never comes back.
      seedProgress(EMPTY_ENTRIES);
      seedSession({ id: "sess-1", elapsedMs: 60_000 });
      useFakeClock();
      const view = renderCrossword();
      await advance(5_000);

      view.unmount();

      expect(lastPatchBody()).toMatchObject({
        elapsed_ms: 65_000,
        completed: false,
      });
    });

    it("keeps the clock stopped when the page mounts in a hidden tab", async () => {
      seedProgress(EMPTY_ENTRIES);
      seedSession({ id: "sess-9", elapsedMs: 60_000 });
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      useFakeClock();

      renderCrossword();
      await advance(45_000);

      // No phantom active time accrued and no heartbeat fired while hidden.
      expect(timer()).toHaveTextContent("1:00");
      expect(patchBodies()).toHaveLength(0);

      // First focus starts the clock.
      setVisibility("visible");
      await advance(2_000);
      expect(timer()).toHaveTextContent("1:02");
    });

    it("heartbeats the total elapsed every 30 seconds, never lowering it", async () => {
      useFakeClock();
      renderCrossword();
      await startGame();

      await advance(30_000);
      await advance(30_000);

      const bodies = patchBodies();
      expect(bodies).toHaveLength(2);
      expect(bodies[0].elapsed_ms).toBe(30_000);
      expect(bodies[1].elapsed_ms).toBe(60_000);
      expect(bodies[1].elapsed_ms!).toBeGreaterThan(bodies[0].elapsed_ms!);
    });

    it("stops the heartbeat while paused", async () => {
      useFakeClock();
      renderCrossword();
      await startGame();

      await advance(5_000);
      fireEvent.click(screen.getByRole("button", { name: "Pause timer" }));
      await flushAsync();

      // The pause itself flushed once; a paused solve must not keep
      // reporting, however long it sits.
      expect(patchBodies()).toHaveLength(1);
      await advance(65_000);
      expect(patchBodies()).toHaveLength(1);
    });

    it("clamps reported elapsed time to the backend's 24 hour ceiling", async () => {
      // 5 seconds shy of the cap; the next heartbeat would overshoot it.
      seedProgress(EMPTY_ENTRIES);
      seedSession({ id: "sess-1", elapsedMs: 86_395_000 });
      useFakeClock();

      renderCrossword();
      await advance(30_000);

      expect(lastPatchBody().elapsed_ms).toBe(86_400_000);
    });

    it("keeps recording time when the readout is hidden", async () => {
      useFakeClock();
      renderCrossword();
      fireEvent.click(
        screen.getByRole("checkbox", { name: /show the timer/i }),
      );
      await startGame();

      expect(screen.queryByTestId("crossword-timer")).not.toBeInTheDocument();
      await advance(30_000);

      // The report still carries the real elapsed time.
      expect(lastPatchBody()).toMatchObject({ elapsed_ms: 30_000 });
    });
  });

  describe("completion and leaderboard", () => {
    it("reports completion and shows the server-recorded difficulty and time", async () => {
      // The guest solved on hard, but the server's record says easy was used
      // at some point; the dialog must show the server's value.
      seedProgress(ALL_BUT_LAST, "hard");
      seedSession({ id: "sess-1", elapsedMs: 120_000, difficulty: "hard" });
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) => {
          if (options?.method === "PATCH") {
            return Promise.resolve(
              makeSession({
                difficulty: "easy",
                completed_at: "2026-06-12T00:00:00Z",
              }),
            );
          }
          if (path.startsWith("/games/leaderboard")) {
            return Promise.resolve({ items: [], total: 0 });
          }
          return Promise.reject(new Error(`unexpected ${path}`));
        },
      );

      renderCrossword();
      await solveLastLetter();

      const completion = patchBodies().find((body) => body.completed);
      expect(completion).toBeDefined();
      expect(completion!.elapsed_ms).toBeGreaterThanOrEqual(120_000);

      await waitFor(() =>
        expect(
          screen.getByTestId("crossword-completion-dialog"),
        ).toHaveTextContent(/in 2:00 with the easy clues/),
      );
      expect(storedSession().completed).toBe(true);
    });

    it("keeps the local easiest difficulty when the server reports a harder one", async () => {
      // The server missed the easy report (it never arrived), so it still
      // says hard; the recorded difficulty is the min of both views, and the
      // dialog must show the local easiest.
      seedProgress(ALL_BUT_LAST, "easy");
      seedSession({ id: "sess-1", elapsedMs: 120_000, difficulty: "easy" });
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) => {
          if (options?.method === "PATCH") {
            return Promise.resolve(
              makeSession({
                difficulty: "hard",
                completed_at: "2026-06-12T00:00:00Z",
              }),
            );
          }
          if (path.startsWith("/games/leaderboard")) {
            return Promise.resolve({ items: [], total: 0 });
          }
          return Promise.reject(new Error(`unexpected ${path}`));
        },
      );

      renderCrossword();
      await solveLastLetter();

      await waitFor(() =>
        expect(
          screen.getByTestId("crossword-completion-dialog"),
        ).toHaveTextContent(/in 2:00 with the easy clues/),
      );
    });

    it("never reports a restored solve that has no session record", async () => {
      // Solved progress from before session tracking existed (or whose
      // session record was cleared): there is no honest time, so nothing may
      // be reported and nothing may be posted.
      seedProgress(SOLUTION);
      useFakeClock();

      renderCrossword();
      await advance(31_000);

      expect(
        apiRequest.mock.calls.some(([path]) =>
          String(path).startsWith("/games/sessions"),
        ),
      ).toBe(false);
      expect(
        screen.queryByRole("button", { name: "Post your time" }),
      ).not.toBeInTheDocument();
      // The solve still reads as solved; it just carries no time.
      expect(screen.getByRole("status")).toHaveTextContent(/you solved it/i);
      // With no honest time there is nothing for the readout to show, so no
      // frozen 0:00 timer renders either.
      expect(screen.queryByTestId("crossword-timer")).not.toBeInTheDocument();

      // Hiding the tab must not mint a session record either: the record's
      // absence is exactly what marks this solve unreportable on the next
      // visit, so flushOnHide persisting one would reopen the loophole.
      setVisibility("hidden");
      expect(localStorage.getItem(SESSION_KEY)).toBeNull();
    });

    it("prefills the display name for a signed-in guest and posts it", async () => {
      localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, "a.guest.jwt");
      seedProgress(ALL_BUT_LAST);
      seedSession({ id: "sess-1", elapsedMs: 60_000 });
      const base = apiRequest.getMockImplementation()!;
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string; body?: unknown }) => {
          if (path === "/guest/rsvp" && (options?.method ?? "GET") === "GET") {
            return Promise.resolve({
              guests: [{ id: "g1", full_name: "Alice Smith" }],
              events: [],
              responded: false,
              closed: false,
            });
          }
          if (path === "/games/sessions/sess-1/leaderboard") {
            return Promise.resolve(
              makeSession({
                display_name: (options?.body as { display_name: string })
                  .display_name,
              }),
            );
          }
          return base(path, options);
        },
      );

      renderCrossword();
      await solveLastLetter();

      const input = await screen.findByLabelText("Display name");
      await waitFor(() => expect(input).toHaveValue("Alice Smith"));

      fireEvent.click(screen.getByRole("button", { name: "Post my time" }));
      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          "/games/sessions/sess-1/leaderboard",
          expect.objectContaining({
            method: "POST",
            body: { display_name: "Alice Smith" },
            token: "a.guest.jwt",
          }),
        ),
      );
      // The dialog confirms, and the opt-in survives a reload.
      await waitFor(() =>
        expect(
          screen.getByTestId("crossword-completion-dialog"),
        ).toHaveTextContent(/on the leaderboard/i),
      );
      expect(storedSession().postedName).toBe("Alice Smith");
    });

    it("prompts anonymous guests for a name and validates it", async () => {
      seedProgress(ALL_BUT_LAST);
      seedSession({ id: "sess-1", elapsedMs: 60_000 });
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string; body?: unknown }) => {
          if (options?.method === "PATCH") {
            return Promise.resolve(makeSession());
          }
          if (path === "/games/sessions/sess-1/leaderboard") {
            return Promise.resolve(makeSession({ display_name: "Bob" }));
          }
          if (path.startsWith("/games/leaderboard")) {
            return Promise.resolve({ items: [], total: 0 });
          }
          return Promise.reject(new Error(`unexpected ${path}`));
        },
      );

      renderCrossword();
      await solveLastLetter();

      const input = await screen.findByLabelText("Display name");
      expect(input).toHaveValue("");
      const postButton = screen.getByRole("button", { name: "Post my time" });
      // Empty names can't post.
      expect(postButton).toBeDisabled();
      // Nor can names past 50 characters.
      fireEvent.change(input, { target: { value: "x".repeat(51) } });
      expect(postButton).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(/under 50/i);
      // A padded name posts trimmed.
      fireEvent.change(input, { target: { value: "  Bob  " } });
      expect(postButton).toBeEnabled();
      fireEvent.click(postButton);

      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          "/games/sessions/sess-1/leaderboard",
          expect.objectContaining({ body: { display_name: "Bob" } }),
        ),
      );
    });

    it("accepts a display name of exactly 50 characters", async () => {
      const name = "x".repeat(50);
      seedProgress(ALL_BUT_LAST);
      seedSession({ id: "sess-1", elapsedMs: 60_000 });
      const base = apiRequest.getMockImplementation()!;
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) => {
          if (path === "/games/sessions/sess-1/leaderboard") {
            return Promise.resolve(makeSession({ display_name: name }));
          }
          return base(path, options);
        },
      );

      renderCrossword();
      await solveLastLetter();

      const input = await screen.findByLabelText("Display name");
      fireEvent.change(input, { target: { value: name } });
      const postButton = screen.getByRole("button", { name: "Post my time" });
      expect(postButton).toBeEnabled();
      fireEvent.click(postButton);

      await waitFor(() =>
        expect(apiRequest).toHaveBeenCalledWith(
          "/games/sessions/sess-1/leaderboard",
          expect.objectContaining({ body: { display_name: name } }),
        ),
      );
    });

    it("refetches the leaderboard after a successful post", async () => {
      seedProgress(ALL_BUT_LAST);
      seedSession({ id: "sess-1", elapsedMs: 60_000 });
      const base = apiRequest.getMockImplementation()!;
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) => {
          if (path === "/games/sessions/sess-1/leaderboard") {
            return Promise.resolve(makeSession({ display_name: "Bob" }));
          }
          return base(path, options);
        },
      );
      const leaderboardGets = () =>
        apiRequest.mock.calls.filter(([path]) =>
          String(path).startsWith("/games/leaderboard"),
        ).length;

      renderCrossword();
      await solveLastLetter();

      // The completion dialog's warm-up fetch ran before the post...
      const input = await screen.findByLabelText("Display name");
      await waitFor(() => expect(leaderboardGets()).toBeGreaterThan(0));
      const getsBeforePost = leaderboardGets();

      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.click(screen.getByRole("button", { name: "Post my time" }));

      // ...so a successful post refetches it, ensuring "View leaderboard"
      // includes the guest's own entry.
      await waitFor(() =>
        expect(leaderboardGets()).toBeGreaterThan(getsBeforePost),
      );
    });

    it("re-sends an unacknowledged completion before posting", async () => {
      // The completion report failed (offline at the moment of the solve),
      // so posting must first establish the completion, then post.
      seedProgress(ALL_BUT_LAST);
      seedSession({ id: "sess-1", elapsedMs: 60_000 });
      let patchFails = true;
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) => {
          if (options?.method === "PATCH") {
            return patchFails
              ? Promise.reject(new TypeError("network down"))
              : Promise.resolve(
                  makeSession({ completed_at: "2026-06-12T00:00:00Z" }),
                );
          }
          if (path === "/games/sessions/sess-1/leaderboard") {
            return Promise.resolve(makeSession({ display_name: "Bob" }));
          }
          if (path.startsWith("/games/leaderboard")) {
            return Promise.resolve({ items: [], total: 0 });
          }
          return Promise.reject(new Error(`unexpected ${path}`));
        },
      );

      renderCrossword();
      await solveLastLetter();
      expect(storedSession().completed).toBe(false);

      // The network is back by the time the guest posts.
      patchFails = false;
      const input = await screen.findByLabelText("Display name");
      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.click(screen.getByRole("button", { name: "Post my time" }));

      await waitFor(() =>
        expect(
          screen.getByTestId("crossword-completion-dialog"),
        ).toHaveTextContent(/on the leaderboard/i),
      );
      // The completion PATCH landed before the leaderboard POST.
      const methods = apiRequest.mock.calls.map(
        ([path, options]) =>
          [String(path), (options as { method?: string })?.method] as const,
      );
      const lastPatch = methods.reduce(
        (last, [, method], index) => (method === "PATCH" ? index : last),
        -1,
      );
      const postIndex = methods.findIndex(
        ([path, method]) => method === "POST" && path.endsWith("/leaderboard"),
      );
      expect(lastPatch).toBeGreaterThanOrEqual(0);
      expect(postIndex).toBeGreaterThan(lastPatch);
      expect(storedSession().completed).toBe(true);
    });

    it("explains when the post cannot reach the server at all", async () => {
      // No session was ever created (fully offline) and the post's own
      // completion attempt fails too: the dialog must surface the hook's
      // crafted message rather than a generic one.
      seedProgress(ALL_BUT_LAST);
      apiRequest.mockImplementation(() =>
        Promise.reject(new TypeError("network down")),
      );

      renderCrossword();
      await solveLastLetter();

      const input = await screen.findByLabelText("Display name");
      fireEvent.change(input, { target: { value: "Bob" } });
      fireEvent.click(screen.getByRole("button", { name: "Post my time" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /couldn't reach the server to record your solve/i,
      );
      expect(
        screen.getByTestId("crossword-completion-dialog"),
      ).toBeInTheDocument();
    });

    it("surfaces a leaderboard rejection in the dialog and keeps it open", async () => {
      seedProgress(ALL_BUT_LAST);
      seedSession({ id: "sess-1", elapsedMs: 60_000 });
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) => {
          if (options?.method === "PATCH") {
            return Promise.resolve(makeSession());
          }
          if (path === "/games/sessions/sess-1/leaderboard") {
            return Promise.reject(
              new ApiError(409, "this solve is already posted as another name"),
            );
          }
          if (path.startsWith("/games/leaderboard")) {
            return Promise.resolve({ items: [], total: 0 });
          }
          return Promise.reject(new Error(`unexpected ${path}`));
        },
      );

      renderCrossword();
      await solveLastLetter();

      const input = await screen.findByLabelText("Display name");
      fireEvent.change(input, { target: { value: "Rob" } });
      fireEvent.click(screen.getByRole("button", { name: "Post my time" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        /already posted/i,
      );
      // The dialog stays open so the guest can adjust and retry.
      expect(
        screen.getByTestId("crossword-completion-dialog"),
      ).toBeInTheDocument();
      expect(storedSession().postedName).toBeUndefined();
    });

    it("does not show a stale error when the dialog reopens", async () => {
      seedProgress(ALL_BUT_LAST);
      seedSession({ id: "sess-1", elapsedMs: 60_000 });
      apiRequest.mockImplementation(
        (path: string, options?: { method?: string }) => {
          if (options?.method === "PATCH") {
            return Promise.resolve(makeSession());
          }
          if (path === "/games/sessions/sess-1/leaderboard") {
            return Promise.reject(
              new ApiError(409, "this solve is already posted as another name"),
            );
          }
          if (path.startsWith("/games/leaderboard")) {
            return Promise.resolve({ items: [], total: 0 });
          }
          return Promise.reject(new Error(`unexpected ${path}`));
        },
      );

      renderCrossword();
      await solveLastLetter();

      const input = await screen.findByLabelText("Display name");
      fireEvent.change(input, { target: { value: "Rob" } });
      fireEvent.click(screen.getByRole("button", { name: "Post my time" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /already posted/i,
      );

      // Close and reopen: the old failure must not greet the guest again.
      fireEvent.click(screen.getByRole("button", { name: "No thanks" }));
      fireEvent.click(screen.getByRole("button", { name: "Post your time" }));
      expect(
        await screen.findByTestId("crossword-completion-dialog"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/already posted/i)).not.toBeInTheDocument();
    });

    it("treats declining to post as a first-class path", async () => {
      seedProgress(ALL_BUT_LAST);
      seedSession({ id: "sess-1", elapsedMs: 60_000 });

      renderCrossword();
      await solveLastLetter();

      const dialog = await screen.findByTestId("crossword-completion-dialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: "No thanks" }),
      );

      expect(
        screen.queryByTestId("crossword-completion-dialog"),
      ).not.toBeInTheDocument();
      expect(
        apiRequest.mock.calls.some(([path]) =>
          String(path).endsWith("/leaderboard"),
        ),
      ).toBe(false);

      // A change of heart stays possible from the solved summary.
      fireEvent.click(screen.getByRole("button", { name: "Post your time" }));
      expect(
        await screen.findByTestId("crossword-completion-dialog"),
      ).toBeInTheDocument();
    });

    it("renders the leaderboard fastest first", async () => {
      seedProgress(EMPTY_ENTRIES);
      seedSession({ id: "sess-1" });
      apiRequest.mockImplementation((path: string) => {
        if (path.startsWith("/games/leaderboard")) {
          return Promise.resolve({
            items: [
              {
                display_name: "Alice",
                difficulty: "easy",
                elapsed_ms: 61_000,
                completed_at: "2026-06-10T00:00:00Z",
              },
              {
                display_name: "Bob",
                difficulty: "hard",
                elapsed_ms: 95_000,
                completed_at: "2026-06-11T00:00:00Z",
              },
            ],
            total: 12,
          });
        }
        return Promise.resolve(makeSession());
      });

      renderCrossword();
      fireEvent.click(screen.getByRole("button", { name: /leaderboard/i }));

      const dialog = await screen.findByTestId("crossword-leaderboard-dialog");
      expect(apiRequest).toHaveBeenCalledWith(
        "/games/leaderboard?puzzle_id=wedding-mini-v1",
      );
      const rows = await within(dialog).findAllByRole("listitem");
      expect(rows).toHaveLength(2);
      expect(rows[0]).toHaveTextContent("Alice");
      expect(rows[0]).toHaveTextContent("1:01");
      expect(rows[0]).toHaveTextContent("Easy");
      expect(rows[1]).toHaveTextContent("Bob");
      expect(rows[1]).toHaveTextContent("1:35");
      expect(rows[1]).toHaveTextContent("Hard");
      expect(dialog).toHaveTextContent(/fastest 2 of 12/i);
    });

    it("summarizes a returning completed solve without reopening the dialog", async () => {
      seedProgress(SOLUTION);
      seedSession({
        id: "sess-1",
        elapsedMs: 90_000,
        completed: true,
        difficulty: "easy",
      });

      renderCrossword();
      await flushAsync();

      expect(
        screen.queryByTestId("crossword-completion-dialog"),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        /you solved it in 1:30 with the easy clues/i,
      );
      expect(timer()).toHaveTextContent("1:30");
      // The solve is final: no pause control, and nothing reported.
      expect(
        screen.queryByRole("button", { name: "Pause timer" }),
      ).not.toBeInTheDocument();
      expect(patchBodies()).toHaveLength(0);
      // Posting stays available because this solve never opted in.
      expect(
        screen.getByRole("button", { name: "Post your time" }),
      ).toBeInTheDocument();
    });

    it("does not offer to post again once the solve is on the board", async () => {
      seedProgress(SOLUTION);
      seedSession({
        id: "sess-1",
        elapsedMs: 90_000,
        completed: true,
        difficulty: "easy",
        postedName: "Alice",
      });

      renderCrossword();
      await flushAsync();

      expect(
        screen.queryByRole("button", { name: "Post your time" }),
      ).not.toBeInTheDocument();
    });
  });
});
