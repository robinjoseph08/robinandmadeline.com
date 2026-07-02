import { afterEach, describe, expect, it, vi } from "vitest";

import type { PartyResponse } from "@/types/generated/parties";

import {
  downloadPartiesCsv,
  partiesCsvContent,
  partiesCsvFilename,
} from "./partiesCsv";

// A fully-populated party; individual tests override the fields they exercise.
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

describe("partiesCsvContent", () => {
  it("emits just the header row in column order for an empty list", () => {
    expect(partiesCsvContent([])).toBe(HEADER);
  });

  it("writes one CRLF-terminated row per party with the mailing columns", () => {
    // The default party is in the US, so its country cell is intentionally
    // blank: the printer does not need a country line for domestic mail.
    const csv = partiesCsvContent([makeParty()]);
    expect(csv).toBe(
      `${HEADER}\r\n` +
        "Mr. and Mrs. Smith,123 Main St,,Springfield,IL,62704,,physical",
    );
  });

  it("renders absent (null) address fields as empty cells", () => {
    const csv = partiesCsvContent([
      makeParty({
        address_line_1: undefined,
        address_line_2: undefined,
        city: undefined,
        state_or_province: undefined,
        postal_code: undefined,
        country: undefined,
      }),
    ]);
    const [, row] = csv.split("\r\n");
    expect(row).toBe("Mr. and Mrs. Smith,,,,,,,physical");
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    const csv = partiesCsvContent([
      makeParty({
        name: 'Smith, Jr. "the third"',
        address_line_2: "Apt 4\nRear",
      }),
    ]);
    const [, row] = csv.split("\r\n");
    expect(row).toBe(
      '"Smith, Jr. ""the third""",123 Main St,"Apt 4\nRear",Springfield,IL,62704,,physical',
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

  it("upper-cases a non-US country and keeps its country line", () => {
    const [, row] = partiesCsvContent([makeParty({ country: "Canada" })]).split(
      "\r\n",
    );
    expect(row).toBe(
      "Mr. and Mrs. Smith,123 Main St,,Springfield,IL,62704,CANADA,physical",
    );
  });

  it("omits the country line for a US address, case-insensitively", () => {
    const [, row] = partiesCsvContent([
      makeParty({ country: "united states" }),
    ]).split("\r\n");
    expect(row).toBe(
      "Mr. and Mrs. Smith,123 Main St,,Springfield,IL,62704,,physical",
    );
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

  it("triggers a browser download of the BOM-prefixed CSV", async () => {
    vi.useFakeTimers();
    // jsdom implements neither createObjectURL nor revokeObjectURL.
    const createObjectURL = vi.fn().mockReturnValue("blob:fake-url");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});

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

    // The blob URL outlives the click (revoking in the same task cancels the
    // download in Safari); it is still revoked eventually.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake-url");
  });
});
