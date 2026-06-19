import { afterEach, describe, expect, it, vi } from "vitest";

import type { Event } from "@/types/generated/models";

import {
  downloadICS,
  googleCalendarUrl,
  icsContent,
  icsFilename,
} from "./calendar";

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "0190b8e0-0000-7000-8000-00000000000a",
    name: "Reception",
    description: undefined,
    location: undefined,
    date: "2026-10-17",
    start_time: undefined,
    end_time: undefined,
    is_public: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("googleCalendarUrl", () => {
  it("builds a prefilled template link for a timed event", () => {
    const url = new URL(
      googleCalendarUrl(
        makeEvent({
          start_time: "17:00",
          end_time: "22:00",
          location: "The Grand Hall",
          description: "Dinner and dancing.",
        }),
      ),
    );

    expect(url.origin + url.pathname).toBe(
      "https://calendar.google.com/calendar/render",
    );
    expect(url.searchParams.get("action")).toBe("TEMPLATE");
    expect(url.searchParams.get("text")).toBe("Reception");
    expect(url.searchParams.get("dates")).toBe(
      "20261017T170000/20261017T220000",
    );
    // Times are the venue's wall-clock values; ctz pins them to the venue
    // timezone no matter where the guest opens the link.
    expect(url.searchParams.get("ctz")).toBe("America/Chicago");
    expect(url.searchParams.get("location")).toBe("The Grand Hall");
    // The details carry the event text, then the labeled schedule link.
    expect(url.searchParams.get("details")).toBe(
      "Dinner and dancing.\n\nSchedule: https://www.robinandmadeline.com/schedule",
    );
  });

  it("omits location and keeps only the site link as details when the event has neither", () => {
    const url = new URL(googleCalendarUrl(makeEvent({ start_time: "17:00" })));
    expect(url.searchParams.get("location")).toBeNull();
    expect(url.searchParams.get("details")).toBe(
      "Schedule: https://www.robinandmadeline.com/schedule",
    );
  });

  it("appends a Map line to the details when the event has a location link", () => {
    const url = new URL(
      googleCalendarUrl(
        makeEvent({
          start_time: "17:00",
          location: "The Grand Hall",
          location_url: "https://maps.app.goo.gl/abc123",
        }),
      ),
    );
    // The label still rides in the location field; the precise link travels in
    // the details so it reaches the guest's calendar.
    expect(url.searchParams.get("location")).toBe("The Grand Hall");
    expect(url.searchParams.get("details")).toBe(
      "Schedule: https://www.robinandmadeline.com/schedule\nMap: https://maps.app.goo.gl/abc123",
    );
  });

  it("builds an all-day link when the event has no start time", () => {
    const url = new URL(googleCalendarUrl(makeEvent()));
    // All-day format: date only, exclusive end the next day, no timezone (a
    // calendar day has no wall-clock to pin).
    expect(url.searchParams.get("dates")).toBe("20261017/20261018");
    expect(url.searchParams.get("ctz")).toBeNull();
  });

  it("rolls an all-day event's exclusive end across a year boundary", () => {
    const url = new URL(googleCalendarUrl(makeEvent({ date: "2026-12-31" })));
    expect(url.searchParams.get("dates")).toBe("20261231/20270101");
  });

  it("defaults a missing end time to one hour after the start", () => {
    const url = new URL(googleCalendarUrl(makeEvent({ start_time: "17:00" })));
    expect(url.searchParams.get("dates")).toBe(
      "20261017T170000/20261017T180000",
    );
  });

  it("treats a JSON-null end time like a missing one", () => {
    // The generated Event type says `end_time?: string`, but at runtime the
    // API serializes an absent optional as null (Go marshals nil *string as
    // null), so the helpers must tolerate null as well as undefined.
    const event = makeEvent({ start_time: "17:00" });
    (event as { end_time: string | null }).end_time = null;
    const url = new URL(googleCalendarUrl(event));
    expect(url.searchParams.get("dates")).toBe(
      "20261017T170000/20261017T180000",
    );
  });

  it("rolls the default end past midnight onto the next day", () => {
    const url = new URL(googleCalendarUrl(makeEvent({ start_time: "23:30" })));
    expect(url.searchParams.get("dates")).toBe(
      "20261017T233000/20261018T003000",
    );
  });

  it("treats an end time earlier than the start as past midnight", () => {
    const url = new URL(
      googleCalendarUrl(makeEvent({ start_time: "20:00", end_time: "01:00" })),
    );
    expect(url.searchParams.get("dates")).toBe(
      "20261017T200000/20261018T010000",
    );
  });
});

describe("icsContent", () => {
  const now = new Date("2026-06-11T08:30:00Z");

  it("renders a timed event with venue-timezone local times", () => {
    const ics = icsContent(
      makeEvent({
        start_time: "17:00",
        end_time: "22:00",
        location: "The Grand Hall",
        description: "Dinner and dancing.",
      }),
      now,
    );

    // CRLF line endings throughout (RFC 5545 content lines).
    expect(ics).toContain("\r\n");
    expect(ics.split("\r\n")).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain(
      "UID:0190b8e0-0000-7000-8000-00000000000a@robinandmadeline.com",
    );
    expect(ics).toContain("DTSTAMP:20260611T083000Z");
    expect(ics).toContain("DTSTART;TZID=America/Chicago:20261017T170000");
    expect(ics).toContain("DTEND;TZID=America/Chicago:20261017T220000");
    expect(ics).toContain("SUMMARY:Reception");
    expect(ics).toContain("LOCATION:The Grand Hall");
    // The description carries the event text, then the labeled schedule link.
    expect(ics).toContain(
      "DESCRIPTION:Dinner and dancing.\\n\\nSchedule: https://www.robinandmadeline.com/schedule",
    );
    // The referenced TZID is defined in the file so strict parsers resolve it.
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("TZID:America/Chicago");
    // The DST rules are hand-maintained; a corrupted offset would shift every
    // imported event by an hour in strict clients, so pin them.
    expect(ics).toContain("TZOFFSETFROM:-0600");
    expect(ics).toContain("TZOFFSETTO:-0500");
    expect(ics).toContain("TZOFFSETFROM:-0500");
    expect(ics).toContain("TZOFFSETTO:-0600");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU");
    expect(ics).toContain("RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU");
  });

  it("renders an untimed event as an all-day event", () => {
    const ics = icsContent(makeEvent(), now);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261017");
    // The exclusive all-day end is the next day.
    expect(ics).toContain("DTEND;VALUE=DATE:20261018");
    // No local times are referenced, so no timezone definition is needed.
    expect(ics).not.toContain("BEGIN:VTIMEZONE");
  });

  it("omits LOCATION and keeps only the site link as DESCRIPTION when the event has neither", () => {
    const ics = icsContent(makeEvent({ start_time: "17:00" }), now);
    expect(ics).not.toContain("LOCATION:");
    expect(ics).toContain(
      "DESCRIPTION:Schedule: https://www.robinandmadeline.com/schedule\r\n",
    );
  });

  it("adds a Map line to the DESCRIPTION and escapes the link when the event has a location link", () => {
    const ics = icsContent(
      makeEvent({
        location: "The Grand Hall",
        // A real maps URL carries commas (coordinates), which RFC 5545 requires
        // escaped inside a content line.
        location_url: "https://maps.example.com/?q=40.1,-88.2",
      }),
      now,
    );
    expect(ics).toContain("LOCATION:The Grand Hall");
    expect(ics).toContain(
      "DESCRIPTION:Schedule: https://www.robinandmadeline.com/schedule\\nMap: https://maps.example.com/?q=40.1\\,-88.2",
    );
  });

  it("orders the DESCRIPTION as event text, then Schedule, then Map when all are present", () => {
    const ics = icsContent(
      makeEvent({
        description: "Dinner and dancing.",
        location: "The Grand Hall",
        location_url: "https://maps.app.goo.gl/abc123",
      }),
      now,
    );
    expect(ics).toContain(
      "DESCRIPTION:Dinner and dancing.\\n\\nSchedule: https://www.robinandmadeline.com/schedule\\nMap: https://maps.app.goo.gl/abc123",
    );
  });

  it("escapes commas, semicolons, backslashes, and newlines in text", () => {
    const ics = icsContent(
      makeEvent({
        name: "Dinner; Dancing, Fun\\Stuff",
        description: "Line one\nLine two",
      }),
      now,
    );
    expect(ics).toContain("SUMMARY:Dinner\\; Dancing\\, Fun\\\\Stuff");
    expect(ics).toContain(
      "DESCRIPTION:Line one\\nLine two\\n\\nSchedule: https://www.robinandmadeline.com/schedule",
    );
  });

  it("folds CRLF and lone CR newlines to the escaped form too", () => {
    // A raw CR or LF inside a content line is invalid iCalendar, so every
    // newline flavor a JSON payload can carry must collapse to \n.
    const ics = icsContent(
      makeEvent({ description: "CRLF\r\nthen\rlone CR" }),
      now,
    );
    expect(ics).toContain(
      "DESCRIPTION:CRLF\\nthen\\nlone CR\\n\\nSchedule: https://www.robinandmadeline.com/schedule",
    );
  });
});

describe("icsFilename", () => {
  it("slugifies the event name", () => {
    expect(
      icsFilename(makeEvent({ name: "Rehearsal Dinner / Madhuram Veppu" })),
    ).toBe("rehearsal-dinner-madhuram-veppu.ics");
  });

  it("falls back to a generic name when nothing survives slugification", () => {
    expect(icsFilename(makeEvent({ name: "???" }))).toBe("event.ics");
  });
});

describe("downloadICS", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    // jsdom never defines these, so removing the stubs restores its state.
    delete (URL as Partial<typeof URL>).createObjectURL;
    delete (URL as Partial<typeof URL>).revokeObjectURL;
  });

  it("triggers a browser download of the .ics file", async () => {
    vi.useFakeTimers();
    // jsdom implements neither createObjectURL nor revokeObjectURL.
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

    downloadICS(makeEvent({ start_time: "17:00" }));

    // The downloaded blob really is the event's .ics body, not just any blob.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/calendar;charset=utf-8");
    const body = await blob.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).toContain("SUMMARY:Reception");
    expect(click).toHaveBeenCalledTimes(1);

    // The blob URL outlives the click (revoking in the same task cancels the
    // download in Safari); it is still revoked eventually.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });
});
