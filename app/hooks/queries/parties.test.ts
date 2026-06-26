import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { adminRequest } from "@/libraries/admin-api";
import type {
  ListPartiesResponse,
  PartyResponse,
} from "@/types/generated/parties";

import {
  QueryKey,
  useCreatePartyWithGuest,
  useDeleteParty,
  useMarkInfo,
  usePatchParty,
  useRequestInfo,
  useUpdateParty,
} from "./parties";
import { QueryKey as TagsQueryKey } from "./tags";

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

describe("useCreatePartyWithGuest", () => {
  it("invalidates the parties list, guest list, and tag vocabulary on success", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.ListParties, {}], { items: [], total: 0 });
    client.setQueryData([QueryKey.ListGuests, {}], { items: [], total: 0 });
    client.setQueryData([TagsQueryKey.ListTags], { items: [], total: 0 });

    const { result } = renderHook(() => useCreatePartyWithGuest(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        name: "Test",
        side: "robin",
        relation: "family",
        circle: [],
        invitation_type: "physical",
        guest: {
          full_name: "Pat",
          tags: [],
          is_child: false,
          is_drinking: false,
        },
      });
    });

    await waitFor(() => {
      expect(
        client.getQueryState([QueryKey.ListParties, {}])?.isInvalidated,
      ).toBe(true);
    });
    expect(client.getQueryState([QueryKey.ListGuests, {}])?.isInvalidated).toBe(
      true,
    );
    // The first guest may carry tags, so the vocabulary is refreshed too.
    expect(client.getQueryState([TagsQueryKey.ListTags])?.isInvalidated).toBe(
      true,
    );
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

describe("usePatchParty", () => {
  it("PATCHes only the changed field and invalidates the affected caches", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.RetrieveParty, "p1"], { id: "p1" });
    client.setQueryData([QueryKey.ListParties, {}], { items: [], total: 0 });
    client.setQueryData([QueryKey.ListGuests, {}], { items: [], total: 0 });
    vi.mocked(adminRequest).mockClear();
    vi.mocked(adminRequest).mockResolvedValueOnce({
      id: "p1",
      invitation_type: "physical",
    });

    const { result } = renderHook(() => usePatchParty(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        partyId: "p1",
        payload: { invitation_type: "physical" },
      });
    });

    // A single-cell save sends just that field via PATCH, not the whole party.
    expect(adminRequest).toHaveBeenCalledWith("/admin/parties/p1", {
      method: "PATCH",
      body: { invitation_type: "physical" },
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

  it("writes the response through the detail and list caches before any refetch", async () => {
    const client = newClient();
    const guests = [{ id: "g1", full_name: "Pat" }];
    client.setQueryData([QueryKey.RetrieveParty, "p1"], {
      id: "p1",
      name: "Old Name",
      guests,
    });
    client.setQueryData([QueryKey.ListParties, {}], {
      items: [{ id: "p1", name: "Old Name", guests }],
      total: 1,
    });
    vi.mocked(adminRequest).mockClear();
    // The PATCH response carries the patched field but, here, no guests
    // relation, exercising the merge that must not drop a cached guests array.
    vi.mocked(adminRequest).mockResolvedValueOnce({
      id: "p1",
      name: "New Name",
    });

    const { result } = renderHook(() => usePatchParty(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        partyId: "p1",
        payload: { name: "New Name" },
      });
    });

    // The cache holds the patched value immediately, so a dialog opened in the
    // gap before the refetch seeds from fresh state rather than reverting it.
    expect(
      client.getQueryData<PartyResponse>([QueryKey.RetrieveParty, "p1"]),
    ).toMatchObject({ name: "New Name", guests });
    const list = client.getQueryData<ListPartiesResponse>([
      QueryKey.ListParties,
      {},
    ]);
    expect(list?.items[0]).toMatchObject({ name: "New Name", guests });
  });
});

describe("useDeleteParty", () => {
  it("invalidates the parties list and tag vocabulary, and removes the detail query", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.ListParties, {}], { items: [], total: 0 });
    client.setQueryData([QueryKey.RetrieveParty, "p1"], { id: "p1" });
    client.setQueryData([TagsQueryKey.ListTags], { items: [], total: 0 });

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
    // The cascade deletes the party's guests, which can drop a tag from the
    // vocabulary, so it is refreshed too.
    expect(client.getQueryState([TagsQueryKey.ListTags])?.isInvalidated).toBe(
      true,
    );
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
