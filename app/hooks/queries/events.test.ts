import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { adminRequest } from "@/libraries/admin-api";

import {
  QueryKey,
  useCreateEvent,
  useDeleteEvent,
  useInviteParties,
  useUpdateEvent,
  useUpdateEventRSVP,
} from "./events";
import { QueryKey as PartiesQueryKey } from "./parties";

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

const EVENT_PAYLOAD = {
  name: "Reception",
  date: "2026-10-17",
  is_public: true,
  sort_order: 0,
};

describe("useCreateEvent", () => {
  it("invalidates the events and guest lists on success", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.ListEvents], { items: [], total: 0 });
    client.setQueryData([QueryKey.ListGuests, {}], { items: [], total: 0 });
    vi.mocked(adminRequest).mockResolvedValueOnce({ id: "e1" });

    const { result } = renderHook(() => useCreateEvent(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync(EVENT_PAYLOAD);
    });

    expect(adminRequest).toHaveBeenCalledWith("/admin/events", {
      method: "POST",
      body: EVENT_PAYLOAD,
    });
    await waitFor(() => {
      expect(client.getQueryState([QueryKey.ListEvents])?.isInvalidated).toBe(
        true,
      );
    });
    // A public event creates RSVP rows, which the guest list's event filters
    // read, so the flat guest list refetches too.
    expect(client.getQueryState([QueryKey.ListGuests, {}])?.isInvalidated).toBe(
      true,
    );
  });
});

describe("useUpdateEvent", () => {
  it("invalidates the event detail, RSVP list, and events list", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.ListEvents], { items: [], total: 0 });
    client.setQueryData([QueryKey.RetrieveEvent, "e1"], { id: "e1" });
    client.setQueryData([QueryKey.ListEventRSVPs, "e1"], {
      items: [],
      total: 0,
    });

    const { result } = renderHook(() => useUpdateEvent(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        eventId: "e1",
        payload: EVENT_PAYLOAD,
      });
    });

    await waitFor(() => {
      expect(
        client.getQueryState([QueryKey.RetrieveEvent, "e1"])?.isInvalidated,
      ).toBe(true);
    });
    expect(client.getQueryState([QueryKey.ListEvents])?.isInvalidated).toBe(
      true,
    );
    expect(
      client.getQueryState([QueryKey.ListEventRSVPs, "e1"])?.isInvalidated,
    ).toBe(true);
  });
});

describe("useDeleteEvent", () => {
  it("drops the event's cached detail and RSVPs and refreshes the list", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.ListEvents], { items: [], total: 0 });
    client.setQueryData([QueryKey.RetrieveEvent, "e1"], { id: "e1" });
    client.setQueryData([QueryKey.ListEventRSVPs, "e1"], {
      items: [],
      total: 0,
    });

    const { result } = renderHook(() => useDeleteEvent(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({ eventId: "e1" });
    });

    expect(adminRequest).toHaveBeenCalledWith("/admin/events/e1", {
      method: "DELETE",
    });
    await waitFor(() => {
      expect(client.getQueryState([QueryKey.ListEvents])?.isInvalidated).toBe(
        true,
      );
    });
    expect(client.getQueryData([QueryKey.RetrieveEvent, "e1"])).toBeUndefined();
    expect(
      client.getQueryData([QueryKey.ListEventRSVPs, "e1"]),
    ).toBeUndefined();
  });
});

describe("useInviteParties", () => {
  it("posts the party ids and refreshes the event's RSVP list", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.ListEventRSVPs, "e1"], {
      items: [],
      total: 0,
    });

    const { result } = renderHook(() => useInviteParties(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        eventId: "e1",
        payload: { party_ids: ["p1", "p2"] },
      });
    });

    expect(adminRequest).toHaveBeenCalledWith("/admin/events/e1/invite", {
      method: "POST",
      body: { party_ids: ["p1", "p2"] },
    });
    await waitFor(() => {
      expect(
        client.getQueryState([QueryKey.ListEventRSVPs, "e1"])?.isInvalidated,
      ).toBe(true);
    });
  });
});

describe("useUpdateEventRSVP", () => {
  it("puts the override and refreshes the RSVP and parties lists", async () => {
    const client = newClient();
    client.setQueryData([QueryKey.ListEventRSVPs, "e1"], {
      items: [],
      total: 0,
    });
    client.setQueryData([PartiesQueryKey.ListParties, {}], {
      items: [],
      total: 0,
    });

    const { result } = renderHook(() => useUpdateEventRSVP(), {
      wrapper: makeWrapper(client),
    });

    await act(async () => {
      await result.current.mutateAsync({
        eventId: "e1",
        guestId: "g1",
        payload: { status: "attending" },
      });
    });

    expect(adminRequest).toHaveBeenCalledWith("/admin/events/e1/rsvps/g1", {
      method: "PUT",
      body: { status: "attending" },
    });
    await waitFor(() => {
      expect(
        client.getQueryState([QueryKey.ListEventRSVPs, "e1"])?.isInvalidated,
      ).toBe(true);
    });
    // Overall attendance ("coming" anywhere) derives from RSVP rows, so the
    // parties list refetches too.
    expect(
      client.getQueryState([PartiesQueryKey.ListParties, {}])?.isInvalidated,
    ).toBe(true);
  });
});
