import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { GUEST_QUERY_KEYS, resetGuestQueries } from "./guest-cache";
import { QueryKey as PhotoGroupsQueryKey } from "./photo-groups";
import { QueryKey as RSVPQueryKey } from "./rsvp";
import { QueryKey as ScheduleQueryKey } from "./schedule";

describe("resetGuestQueries", () => {
  it("removes every guest-scoped cache so a party switch starts empty", () => {
    const client = new QueryClient();
    client.setQueryData([RSVPQueryKey.PartyRSVPs], { guests: [] });
    client.setQueryData([ScheduleQueryKey.ScheduleEvents], { schedule: {} });
    client.setQueryData([PhotoGroupsQueryKey.PartyPhotoGroups], { items: [] });

    resetGuestQueries(client);

    expect(client.getQueryData([RSVPQueryKey.PartyRSVPs])).toBeUndefined();
    expect(
      client.getQueryData([ScheduleQueryKey.ScheduleEvents]),
    ).toBeUndefined();
    expect(
      client.getQueryData([PhotoGroupsQueryKey.PartyPhotoGroups]),
    ).toBeUndefined();
  });

  it("leaves admin (non-guest) caches untouched", () => {
    const client = new QueryClient();
    client.setQueryData([RSVPQueryKey.PartyRSVPs], { guests: [] });
    // ListPhotoGroups is the admin photographer's shot list, scoped to the
    // admin token, so it must survive a guest party switch.
    client.setQueryData([PhotoGroupsQueryKey.ListPhotoGroups], { items: [] });

    resetGuestQueries(client);

    expect(client.getQueryData([RSVPQueryKey.PartyRSVPs])).toBeUndefined();
    expect(client.getQueryData([PhotoGroupsQueryKey.ListPhotoGroups])).toEqual({
      items: [],
    });
  });

  it("registers exactly the three known guest-scoped keys", () => {
    // Pins the registered set so a rename, removal, or accidental drop of one of
    // the three keys trips here. It cannot catch a brand-new guest surface that
    // was never added to GUEST_QUERY_KEYS (the literal would still match); that
    // case is guarded by the GUEST_QUERY_KEYS doc comment and review.
    expect([...GUEST_QUERY_KEYS]).toEqual([
      RSVPQueryKey.PartyRSVPs,
      ScheduleQueryKey.ScheduleEvents,
      PhotoGroupsQueryKey.PartyPhotoGroups,
    ]);
  });
});
