import { describe, expect, it } from "vitest";

import type { EventResponse } from "@/types/generated/events";

import {
  formatEventWhen,
  formatTime,
  venueTimeZoneAbbreviation,
} from "./format";

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
    sort_order: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    rsvp_breakdown: { pending: 0, attending: 0, not_attending: 0, total: 0 },
    ...overrides,
  };
}

describe("formatTime", () => {
  it("converts stored 24-hour values to 12-hour display", () => {
    expect(formatTime("00:15")).toBe("12:15 AM");
    expect(formatTime("09:30")).toBe("9:30 AM");
    expect(formatTime("12:00")).toBe("12:00 PM");
    expect(formatTime("18:00")).toBe("6:00 PM");
    expect(formatTime("23:59")).toBe("11:59 PM");
  });

  it("returns an unparseable value unchanged", () => {
    expect(formatTime("6pm")).toBe("6pm");
    expect(formatTime("25:00")).toBe("25:00");
  });
});

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
