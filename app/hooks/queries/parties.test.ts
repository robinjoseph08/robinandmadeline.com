import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  QueryKey,
  useCreateParty,
  useDeleteParty,
  useMarkInfo,
  useRequestInfo,
  useUpdateParty,
} from "./parties";

// The hooks call adminRequest; stub it so the tests exercise invalidation, not
// the network. Each test overrides the resolved value where the shape matters.
vi.mock("@/libraries/admin-api", async () => {
  const actual = await vi.importActual<object>("@/libraries/admin-api");
  return {
    ...actual,
    adminRequest: vi.fn().mockResolvedValue(undefined),
  };
});

function makeWrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children);
}

function newClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("useCreateParty", () => {
  it("invalidates the parties list on success", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.ListParties, {}], { items: [], total: 0 });

    const { result } = renderHook(() => useCreateParty(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: "Test",
        side: "robin",
        relation: "family",
        circle: [],
        invitation_type: "digital",
      });
    });

    await waitFor(() => {
      expect(
        client.getQueryState([QueryKey.ListParties, {}])?.isInvalidated,
      ).toBe(true);
    });
  });
});

describe("useUpdateParty", () => {
  it("invalidates the party detail, parties list, and guest list", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.RetrieveParty, "p1"], { id: "p1" });
    client.setQueryData([QueryKey.ListParties, {}], { items: [], total: 0 });
    client.setQueryData([QueryKey.ListGuests, {}], { items: [], total: 0 });

    const { result } = renderHook(() => useUpdateParty(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        partyId: "p1",
        payload: {
          name: "Renamed",
          side: "robin",
          relation: "family",
          circle: [],
          invitation_type: "digital",
        },
      });
    });

    await waitFor(() => {
      expect(
        client.getQueryState([QueryKey.RetrieveParty, "p1"])?.isInvalidated,
      ).toBe(true);
    });
    expect(
      client.getQueryState([QueryKey.ListParties, {}])?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState([QueryKey.ListGuests, {}])?.isInvalidated).toBe(
      true,
    );
  });
});

describe("useDeleteParty", () => {
  it("invalidates the parties list and removes the detail query", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.ListParties, {}], { items: [], total: 0 });
    client.setQueryData([QueryKey.RetrieveParty, "p1"], { id: "p1" });

    const { result } = renderHook(() => useDeleteParty(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ partyId: "p1" });
    });

    await waitFor(() => {
      expect(
        client.getQueryState([QueryKey.ListParties, {}])?.isInvalidated,
      ).toBe(true);
    });
    // The removed detail query no longer has any cached state.
    expect(
      client.getQueryState([QueryKey.RetrieveParty, "p1"]),
    ).toBeUndefined();
  });
});

describe("useRequestInfo", () => {
  it("invalidates the party detail and parties list on success", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.RetrieveParty, "p1"], { id: "p1" });
    client.setQueryData([QueryKey.ListParties, {}], { items: [], total: 0 });

    const { result } = renderHook(() => useRequestInfo(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ partyId: "p1" });
    });

    await waitFor(() => {
      expect(
        client.getQueryState([QueryKey.RetrieveParty, "p1"])?.isInvalidated,
      ).toBe(true);
    });
    expect(
      client.getQueryState([QueryKey.ListParties, {}])?.isInvalidated,
    ).toBe(true);
  });
});

describe("useMarkInfo", () => {
  it("invalidates the party detail and parties list on success", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.RetrieveParty, "p1"], { id: "p1" });
    client.setQueryData([QueryKey.ListParties, {}], { items: [], total: 0 });

    const { result } = renderHook(() => useMarkInfo(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        partyId: "p1",
        payload: { status: "incomplete" },
      });
    });

    await waitFor(() => {
      expect(
        client.getQueryState([QueryKey.RetrieveParty, "p1"])?.isInvalidated,
      ).toBe(true);
    });
    expect(
      client.getQueryState([QueryKey.ListParties, {}])?.isInvalidated,
    ).toBe(true);
  });
});
