import { describe, expect, it } from "vitest";

import {
  formatEventDate,
  formatEventWhen,
  formatGuestFirstNames,
  formatLongDate,
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

describe("formatGuestFirstNames", () => {
  it("renders a single guest by first name", () => {
    expect(formatGuestFirstNames(["Leon Smith"])).toBe("Leon");
  });

  it("joins several guests' first names in order", () => {
    expect(
      formatGuestFirstNames(["Leon Smith", "Leslie Smith", "Riley Smith"]),
    ).toBe("Leon, Leslie, Riley");
  });

  it("keeps a single-word name whole", () => {
    expect(formatGuestFirstNames(["Cher"])).toBe("Cher");
  });

  it("returns an empty string for no names", () => {
    expect(formatGuestFirstNames([])).toBe("");
  });
});
