import { describe, expect, it } from "vitest";

import { formatLongDate, formatTime } from "./format";

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
