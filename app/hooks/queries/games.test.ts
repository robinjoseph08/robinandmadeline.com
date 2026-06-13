// useLeaderboard threads the optional solver session id through to
// fetchLeaderboard and folds it into the query key, so a viewer-aware read
// (after a post) caches separately from the anonymous warm-up while the
// puzzle-id prefix still sweeps both on invalidation.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import type { ListLeaderboardEntriesResponse } from "@/types/generated/games";

import { QueryKey, useLeaderboard } from "./games";

const fetchLeaderboard = vi.fn();
vi.mock("@/libraries/games-api", () => ({
  fetchLeaderboard: (...args: unknown[]) => fetchLeaderboard(...args),
}));

const EMPTY: ListLeaderboardEntriesResponse = { items: [], total: 0 };

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

describe("useLeaderboard", () => {
  it("fetches without a session id and keys on puzzle and difficulty", async () => {
    fetchLeaderboard.mockResolvedValue(EMPTY);
    const client = newClient();

    const { result } = renderHook(
      () => useLeaderboard("wedding-mini-v1", "easy"),
      { wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchLeaderboard).toHaveBeenCalledWith(
      "wedding-mini-v1",
      "easy",
      undefined,
    );
    expect(
      client.getQueryData([
        QueryKey.GameLeaderboard,
        "wedding-mini-v1",
        "easy",
        undefined,
      ]),
    ).toEqual(EMPTY);
  });

  it("passes the session id to fetchLeaderboard and into the query key", async () => {
    fetchLeaderboard.mockResolvedValue(EMPTY);
    const client = newClient();

    const { result } = renderHook(
      () => useLeaderboard("wedding-mini-v1", "medium", {}, "sess-7"),
      { wrapper: makeWrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchLeaderboard).toHaveBeenCalledWith(
      "wedding-mini-v1",
      "medium",
      "sess-7",
    );
    expect(
      client.getQueryData([
        QueryKey.GameLeaderboard,
        "wedding-mini-v1",
        "medium",
        "sess-7",
      ]),
    ).toEqual(EMPTY);
  });

  it("invalidating the puzzle-id prefix still sweeps a viewer-aware key", async () => {
    fetchLeaderboard.mockResolvedValue(EMPTY);
    const client = newClient();

    const { result } = renderHook(
      () => useLeaderboard("wedding-mini-v1", "easy", {}, "sess-7"),
      { wrapper: makeWrapper(client) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // refetchType "none" leaves the invalidated flag set on the observed
    // query (an active refetch would immediately clear it) so the assertion
    // can prove the prefix matched the longer, viewer-aware key.
    await client.invalidateQueries({
      queryKey: [QueryKey.GameLeaderboard, "wedding-mini-v1"],
      refetchType: "none",
    });

    expect(
      client.getQueryState([
        QueryKey.GameLeaderboard,
        "wedding-mini-v1",
        "easy",
        "sess-7",
      ])?.isInvalidated,
    ).toBe(true);
  });
});
