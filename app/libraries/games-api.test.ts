// flushGameSession is the page-going-away report. It must flow through the
// shared gameRequest/apiRequest path like every other API call while still
// reaching the real fetch with keepalive set, so the browser lets the
// request outlive the navigation. These tests pin that the flag survives
// the whole journey to the fetch init.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchLeaderboard, flushGameSession } from "./games-api";

describe("flushGameSession", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("sends a keepalive PATCH through the apiRequest path", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve("{}"),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    flushGameSession("sess-1", {
      elapsed_ms: 4_000,
      difficulty: "easy",
      completed: false,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/games/sessions/sess-1",
      expect.objectContaining({ method: "PATCH", keepalive: true }),
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).toMatchObject({
      elapsed_ms: 4_000,
      completed: false,
    });
  });

  it("never throws when the network is down", async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError("offline")));
    vi.stubGlobal("fetch", fetchMock);

    expect(() =>
      flushGameSession("sess-1", {
        elapsed_ms: 4_000,
        difficulty: "easy",
        completed: false,
      }),
    ).not.toThrow();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});

describe("fetchLeaderboard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function stubOkJson(body: unknown) {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify(body)),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("requests the puzzle and difficulty without a session id by default", async () => {
    const fetchMock = stubOkJson({ items: [], total: 0 });

    await fetchLeaderboard("wedding-mini-v1", "easy");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/games/leaderboard?puzzle_id=wedding-mini-v1&difficulty=easy",
      expect.any(Object),
    );
  });

  it("threads the session id into the session_id query param when given", async () => {
    const fetchMock = stubOkJson({
      items: [],
      total: 0,
      viewer: null,
    });

    await fetchLeaderboard("wedding-mini-v1", "medium", "sess-7");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/games/leaderboard?puzzle_id=wedding-mini-v1&difficulty=medium&session_id=sess-7",
      expect.any(Object),
    );
  });
});
