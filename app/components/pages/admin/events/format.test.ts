import { describe, expect, it } from "vitest";

import { venueTimeZoneAbbreviation } from "@/libraries/format";
import type { EventResponse } from "@/types/generated/events";

import { formatEventWhen } from "./format";

function makeEvent(overrides: Partial<EventResponse>): EventResponse {
  return {
    id: "e1",
    name: "Reception",
    description: undefined,
    location: undefined,
    date: "2026-10-17",
    start_time: undefined,
    end_time: undefined,
    is_public: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    rsvp_breakdown: { pending: 0, attending: 0, not_attending: 0, total: 0 },
    ...overrides,
  };
}

describe("formatEventWhen", () => {
  // The expected zone label comes from the same venue constant the formatter
  // uses, so these tests survive the venue timezone being changed.
  const zone = venueTimeZoneAbbreviation("2026-10-17");

  it("labels every displayed time with the venue timezone", () => {
    expect(zone).not.toBe("");
    expect(
      formatEventWhen(makeEvent({ start_time: "18:00", end_time: "22:00" })),
    ).toBe(`2026-10-17 6:00 PM to 10:00 PM ${zone}`);
    expect(formatEventWhen(makeEvent({ start_time: "16:00" }))).toBe(
      `2026-10-17 4:00 PM ${zone}`,
    );
    expect(formatEventWhen(makeEvent({ end_time: "22:00" }))).toBe(
      `2026-10-17 until 10:00 PM ${zone}`,
    );
  });

  it("shows a bare date with no zone label when the event has no times", () => {
    expect(formatEventWhen(makeEvent({}))).toBe("2026-10-17");
  });
});
