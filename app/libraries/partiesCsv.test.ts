import { afterEach, describe, expect, it, vi } from "vitest";

import type { PartyResponse } from "@/types/generated/parties";

import {
  downloadPartiesCsv,
  partiesCsvContent,
  partiesCsvFilename,
} from "./partiesCsv";

// A fully-populated US party; individual tests override the fields they exercise.
function makeParty(overrides: Partial<PartyResponse> = {}): PartyResponse {
  return {
    id: "0190b8e0-0000-7000-8000-00000000000a",
    name: "Mr. and Mrs. Smith",
    side: "robin",
    relation: "family",
    circle: ["Immediate"],
    invitation_type: "physical",
    address_line_1: "123 Main St",
    address_line_2: undefined,
    city: "Springfield",
    state_or_province: "IL",
    postal_code: "62704",
    country: "United States",
    info_token: "tok_abc",
    rsvp_code: "ABCDE",
    info_collection_requested: false,
    info_collection_confirmed: false,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    info_collection_status: "complete",
    missing_required_fields: [],
    ...overrides,
  };
}

const HEADER =
  "Name,Address Line 1,Address Line 2,City,State/Province,Postal Code,Country,Invitation Type";

// The row a default (US, physical) makeParty() serializes to: US country omitted,
// invitation type title-cased.
const DEFAULT_ROW =
  "Mr. and Mrs. Smith,123 Main St,,Springfield,IL,62704,,Physical";

// Returns the single data row of a one-party CSV. Splitting on the CRLF row
// separator is safe here because a lone CR or LF embedded in a quoted field is
// not a "\r\n" sequence.
function rowFor(party: PartyResponse): string {
  const [, row] = partiesCsvContent([party]).split("\r\n");
  return row;
}

describe("partiesCsvContent", () => {
  it("emits just the header row in column order for an empty list", () => {
    expect(partiesCsvContent([])).toBe(HEADER);
  });

  it("writes one CRLF-separated row per party with the mailing columns", () => {
    // The default party is in the US, so its country cell is intentionally
    // blank: the printer does not need a country line for domestic mail.
    expect(partiesCsvContent([makeParty()])).toBe(
      `${HEADER}\r\n${DEFAULT_ROW}`,
    );
  });

  it("renders absent address fields as empty cells", () => {
    const row = rowFor(
      makeParty({
        address_line_1: undefined,
        address_line_2: undefined,
        city: undefined,
        state_or_province: undefined,
        postal_code: undefined,
        country: undefined,
      }),
    );
    expect(row).toBe("Mr. and Mrs. Smith,,,,,,,Physical");
  });

  // Each special character is tested in isolation: a field carrying two triggers
  // at once (e.g. a comma and a quote) would hide a regression that dropped one
  // trigger from the escape predicate, since the other still forces quoting.
  it("quotes a field that contains only a comma", () => {
    expect(rowFor(makeParty({ name: "Smith, Jr." }))).toBe(
      '"Smith, Jr.",123 Main St,,Springfield,IL,62704,,Physical',
    );
  });

  it("quotes and doubles a field that contains only a double quote", () => {
    expect(rowFor(makeParty({ name: '"Skip" Jones' }))).toBe(
      '"""Skip"" Jones",123 Main St,,Springfield,IL,62704,,Physical',
    );
  });

  it("quotes a field that contains a carriage return", () => {
    expect(rowFor(makeParty({ address_line_2: "Apt 4\rRear" }))).toBe(
      'Mr. and Mrs. Smith,123 Main St,"Apt 4\rRear",Springfield,IL,62704,,Physical',
    );
  });

  it("quotes a field that contains a newline", () => {
    expect(rowFor(makeParty({ address_line_2: "Apt 4\nRear" }))).toBe(
      'Mr. and Mrs. Smith,123 Main St,"Apt 4\nRear",Springfield,IL,62704,,Physical',
    );
  });

  it("keeps rows in the order the parties are given", () => {
    const csv = partiesCsvContent([
      makeParty({ name: "First" }),
      makeParty({ name: "Second" }),
    ]);
    const rows = csv.split("\r\n").slice(1);
    expect(rows.map((row) => row.split(",")[0])).toEqual(["First", "Second"]);
  });

  it("title-cases a digital party's invitation type", () => {
    expect(rowFor(makeParty({ invitation_type: "digital" }))).toBe(
      "Mr. and Mrs. Smith,123 Main St,,Springfield,IL,62704,,Digital",
    );
  });

  describe("country", () => {
    it("upper-cases a non-US country and keeps its country line", () => {
      expect(rowFor(makeParty({ country: "Canada" }))).toBe(
        "Mr. and Mrs. Smith,123 Main St,,Springfield,IL,62704,CANADA,Physical",
      );
    });

    it("omits the country line for a US address, case-insensitively", () => {
      expect(rowFor(makeParty({ country: "united states" }))).toBe(DEFAULT_ROW);
    });

    it("trims surrounding whitespace before matching the US country", () => {
      expect(rowFor(makeParty({ country: "  United States  " }))).toBe(
        DEFAULT_ROW,
      );
    });

    it("trims a non-US country before upper-casing it", () => {
      expect(rowFor(makeParty({ country: "  canada  " }))).toBe(
        "Mr. and Mrs. Smith,123 Main St,,Springfield,IL,62704,CANADA,Physical",
      );
    });
  });
});

describe("partiesCsvFilename", () => {
  it("stamps the local date as parties-YYYY-MM-DD.csv", () => {
    expect(partiesCsvFilename(new Date(2026, 6, 1))).toBe(
      "parties-2026-07-01.csv",
    );
  });

  it("zero-pads single-digit months and days", () => {
    expect(partiesCsvFilename(new Date(2026, 0, 5))).toBe(
      "parties-2026-01-05.csv",
    );
  });
});

describe("downloadPartiesCsv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    // jsdom never defines these, so removing the stubs restores its state.
    delete (URL as Partial<typeof URL>).createObjectURL;
    delete (URL as Partial<typeof URL>).revokeObjectURL;
  });

  it("triggers a browser download of the BOM-prefixed CSV under a dated name", async () => {
    vi.useFakeTimers();
    // jsdom implements neither createObjectURL nor revokeObjectURL.
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    // Capture the anchor before the synchronous remove() so its download name
    // can be asserted (the anchor is removed from the DOM right after the click).
    const appendChild = vi.spyOn(document.body, "appendChild");

    downloadPartiesCsv(
      [makeParty({ name: "Ada Lovelace" })],
      new Date(2026, 6, 1),
    );

    // The downloaded blob really is the CSV body (with a leading UTF-8 BOM so
    // Excel reads it as UTF-8), not just any blob.
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    // The raw bytes lead with the UTF-8 BOM (EF BB BF). Assert on the bytes, not
    // blob.text(), since text() strips a leading BOM when it UTF-8-decodes.
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const body = await blob.text();
    expect(body).toContain(HEADER);
    expect(body).toContain("Ada Lovelace");
    expect(click).toHaveBeenCalledTimes(1);

    // The download is offered under the dated filename, wiring the date argument
    // through to partiesCsvFilename.
    const anchor = appendChild.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.download).toBe("parties-2026-07-01.csv");

    // The blob URL outlives the click (revoking in the same task cancels the
    // download in Safari); it is still revoked eventually.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });
});
