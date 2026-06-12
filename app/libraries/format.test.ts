import { describe, expect, it } from "vitest";

import type { SchedulePhotoGroup } from "@/types/generated/events";

import {
  formatEventDate,
  formatEventWhen,
  formatLongDate,
  formatPhotoGroupsLine,
  formatTime,
} from "./format";

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

describe("formatLongDate", () => {
  it("renders an ISO timestamp as a long date", () => {
    expect(formatLongDate("2026-08-01T12:00:00Z")).toBe("August 1, 2026");
  });
});

describe("formatEventDate", () => {
  it("renders a stored YYYY-MM-DD date with its weekday", () => {
    expect(formatEventDate("2026-10-17")).toBe("Saturday, October 17, 2026");
  });

  it("returns an unparseable value unchanged", () => {
    expect(formatEventDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatEventWhen", () => {
  it("renders date only when the event has no start time", () => {
    expect(formatEventWhen({ date: "2026-10-17", start_time: undefined })).toBe(
      "Saturday, October 17, 2026",
    );
  });

  it("renders date and start time", () => {
    expect(formatEventWhen({ date: "2026-10-17", start_time: "17:00" })).toBe(
      "Saturday, October 17, 2026 · 5:00 PM",
    );
  });

  it("renders date and a time range when an end time is set", () => {
    expect(
      formatEventWhen({
        date: "2026-10-17",
        start_time: "17:00",
        end_time: "22:00",
      }),
    ).toBe("Saturday, October 17, 2026 · 5:00 PM to 10:00 PM");
  });
});

describe("formatPhotoGroupsLine", () => {
  const group = (
    name: string,
    position: number,
    total: number,
  ): SchedulePhotoGroup => ({ id: `pg-${position}`, name, position, total });

  it("names a single group with its position", () => {
    expect(formatPhotoGroupsLine([group("Bride's Family", 3, 12)])).toBe(
      "Stay for photos! You're in: Bride's Family. Group 3 of 12.",
    );
  });

  it("joins two groups with their positions", () => {
    expect(
      formatPhotoGroupsLine([
        group("Bride's Family", 3, 12),
        group("College Friends", 5, 12),
      ]),
    ).toBe(
      "Stay for photos! You're in: Bride's Family, College Friends. Groups 3 and 5 of 12.",
    );
  });

  it("lists three or more positions with commas and a final and", () => {
    expect(
      formatPhotoGroupsLine([
        group("Bride's Family", 2, 12),
        group("College Friends", 5, 12),
        group("Wedding Party", 7, 12),
      ]),
    ).toBe(
      "Stay for photos! You're in: Bride's Family, College Friends, Wedding Party. Groups 2, 5, and 7 of 12.",
    );
  });

  it("returns an empty string when there are no groups", () => {
    expect(formatPhotoGroupsLine([])).toBe("");
  });
});
