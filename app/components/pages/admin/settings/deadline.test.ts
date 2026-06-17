import { describe, expect, it } from "vitest";

import { dateToDeadline, deadlineToDate } from "./deadline";

describe("dateToDeadline", () => {
  it("maps a picked date to the end of that UTC day", () => {
    expect(dateToDeadline("2026-08-01")).toBe("2026-08-01T23:59:59Z");
  });

  it("returns null for a blank or malformed date (the clear gesture)", () => {
    expect(dateToDeadline("")).toBeNull();
    expect(dateToDeadline("08/01/2026")).toBeNull();
    expect(dateToDeadline("not-a-date")).toBeNull();
  });
});

describe("deadlineToDate", () => {
  it("extracts the UTC date from a stored deadline", () => {
    expect(deadlineToDate("2026-08-01T23:59:59Z")).toBe("2026-08-01");
  });

  it("round-trips with dateToDeadline", () => {
    const stored = dateToDeadline("2026-12-25");
    expect(stored).not.toBeNull();
    expect(deadlineToDate(stored)).toBe("2026-12-25");
  });

  it("returns empty for an unset or unparseable value", () => {
    expect(deadlineToDate(null)).toBe("");
    expect(deadlineToDate(undefined)).toBe("");
    expect(deadlineToDate("garbage")).toBe("");
  });
});
