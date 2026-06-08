import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { adminRequest } from "@/libraries/admin-api";

import {
  QueryKey,
  useCreateGuest,
  useDeleteGuest,
  usePatchGuest,
  useUpdateGuest,
} from "./guests";
import { QueryKey as PartiesQueryKey } from "./parties";

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

// Seeds the three caches a guest write should invalidate and asserts all three
// end up invalidated after the mutation resolves.
async function expectGuestWriteInvalidations(
  client: QueryClient,
  mutate: () => Promise<unknown>,
) {
  client.setQueryData([QueryKey.ListGuests, {}], { items: [], total: 0 });
  client.setQueryData([PartiesQueryKey.RetrieveParty, "p1"], { id: "p1" });
  client.setQueryData([PartiesQueryKey.ListParties, {}], {
    items: [],
    total: 0,
  });

  await act(async () => {
    await mutate();
  });

  await waitFor(() => {
    expect(client.getQueryState([QueryKey.ListGuests, {}])?.isInvalidated).toBe(
      true,
    );
  });
  expect(
    client.getQueryState([PartiesQueryKey.RetrieveParty, "p1"])?.isInvalidated,
  ).toBe(true);
  expect(
    client.getQueryState([PartiesQueryKey.ListParties, {}])?.isInvalidated,
  ).toBe(true);
}

describe("useCreateGuest", () => {
  it("invalidates the guest list, parent party detail, and parties list", async () => {
    const client = newClient();
    const { result } = renderHook(() => useCreateGuest(), {
      wrapper: makeWrapper(client),
    });

    await expectGuestWriteInvalidations(client, () =>
      result.current.mutateAsync({
        partyId: "p1",
        payload: {
          full_name: "Jane",
          roles: [],
          is_primary: true,
          is_child: false,
          is_drinking: false,
          is_placeholder: false,
        },
      }),
    );
  });
});

describe("useUpdateGuest", () => {
  it("PUTs the full state and invalidates the guest list, party detail, and parties list", async () => {
    const client = newClient();
    vi.mocked(adminRequest).mockClear();
    const { result } = renderHook(() => useUpdateGuest(), {
      wrapper: makeWrapper(client),
    });

    await expectGuestWriteInvalidations(client, () =>
      result.current.mutateAsync({
        guestId: "g1",
        partyId: "p1",
        payload: {
          full_name: "Jane Doe",
          roles: [],
          is_primary: true,
          is_child: false,
          is_drinking: false,
          is_placeholder: false,
        },
      }),
    );

    // The dialog "full edit" replaces every field, so it uses PUT.
    expect(adminRequest).toHaveBeenCalledWith(
      "/admin/guests/g1",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});

describe("usePatchGuest", () => {
  it("PATCHes only the changed field and invalidates the same caches", async () => {
    const client = newClient();
    vi.mocked(adminRequest).mockClear();
    const { result } = renderHook(() => usePatchGuest(), {
      wrapper: makeWrapper(client),
    });

    await expectGuestWriteInvalidations(client, () =>
      result.current.mutateAsync({
        guestId: "g1",
        partyId: "p1",
        payload: { is_primary: true },
      }),
    );

    // A single-cell save sends just that field via PATCH (partyId is only for
    // cache scoping, never part of the request body).
    expect(adminRequest).toHaveBeenCalledWith("/admin/guests/g1", {
      method: "PATCH",
      body: { is_primary: true },
    });
  });
});

describe("useDeleteGuest", () => {
  it("invalidates the guest list, parent party detail, and parties list", async () => {
    const client = newClient();
    const { result } = renderHook(() => useDeleteGuest(), {
      wrapper: makeWrapper(client),
    });

    await expectGuestWriteInvalidations(client, () =>
      result.current.mutateAsync({ guestId: "g1", partyId: "p1" }),
    );
  });
});
