import { afterEach, describe, expect, it, vi } from "vitest";

import type { GuestListItem, PartyResponse } from "@/types/generated/parties";

import {
  downloadGuestsCsv,
  GUEST_CSV_COLUMNS,
  guestsCsvContent,
  guestsCsvFilename,
} from "./guestsCsv";

function makeGuest(overrides: Partial<GuestListItem> = {}): GuestListItem {
  return {
    id: "g1",
    party_id: "p1",
    party_name: "The Smiths",
    full_name: "Ada Smith",
    email: "ada@example.com",
    phone: "+14155552671",
    tags: ["Family", "VIP"],
    is_primary: true,
    is_child: false,
    is_drinking: true,
    subscribed: false,
    placeholder_text: "Guest of Grace",
    dietary_restrictions: "Vegetarian",
    table_number: 4,
    seat_number: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeParty(overrides: Partial<PartyResponse> = {}): PartyResponse {
  return {
    id: "p1",
    name: "The Smiths",
    side: "madeline",
    relation: "friend",
    circle: ["College", "Work"],
    invitation_type: "physical",
    address_line_1: "123 Main St",
    address_line_2: "Apt 4",
    city: "Springfield",
    state_or_province: "IL",
    postal_code: "62704",
    country: "United States",
    info_token: "tok_p1",
    rsvp_code: "ABCDE",
    info_collection_requested: true,
    info_collection_confirmed: true,
    info_collection_status: "complete",
    missing_required_fields: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    guests: [],
    ...overrides,
  };
}

const HEADER =
  "Name,Email,Phone,Tags,Child,Drinking,Placeholder,Primary,Dietary,Table,Seat,Party,Side,Relation,Circle,Invitation,Address Line 1,Address Line 2,City,State/Province,Postal Code,Country,RSVP Code";

function dataRow(
  guest: GuestListItem,
  parties: PartyResponse[] = [makeParty()],
): string {
  return guestsCsvContent([guest], parties).split("\r\n")[1];
}

describe("guestsCsvContent", () => {
  it("exports every guest and party grid column except subscribed and info status", () => {
    expect(GUEST_CSV_COLUMNS.map((column) => column.label).join(",")).toBe(
      HEADER,
    );
    expect(HEADER).not.toContain("Subscribed");
    expect(HEADER).not.toContain("Info status");

    expect(guestsCsvContent([makeGuest()], [makeParty()])).toBe(
      `${HEADER}\r\nAda Smith,ada@example.com,(415) 555-2671,Family; VIP,No,Yes,Guest of Grace,Yes,Vegetarian,4,2,The Smiths,Madeline,Friend,College; Work,Physical,123 Main St,Apt 4,Springfield,IL,62704,United States,ABCDE`,
    );
  });

  it("exports stored phone numbers in their fully formatted display form", () => {
    expect(dataRow(makeGuest({ phone: "+14155552671" })).split(",")[2]).toBe(
      "(415) 555-2671",
    );
  });

  it("preserves a legacy digit-only phone as spreadsheet text", () => {
    expect(dataRow(makeGuest({ phone: "02079460958" })).split(",")[2]).toBe(
      "'02079460958",
    );
  });

  it("renders optional values, boolean columns, and false primary values consistently", () => {
    expect(
      dataRow(
        makeGuest({
          email: undefined,
          phone: undefined,
          tags: [],
          is_primary: false,
          is_child: true,
          is_drinking: true,
          placeholder_text: undefined,
          dietary_restrictions: undefined,
          table_number: undefined,
          seat_number: undefined,
        }),
        [
          makeParty({
            circle: [],
            address_line_1: undefined,
            address_line_2: undefined,
            city: undefined,
            state_or_province: undefined,
            postal_code: undefined,
            country: undefined,
            rsvp_code: undefined,
          }),
        ],
      ),
    ).toBe(
      "Ada Smith,,,,Yes,Yes,,No,,,,The Smiths,Madeline,Friend,,Physical,,,,,,,",
    );
  });

  it("renders null API values as empty cells", () => {
    const guest = makeGuest({
      email: null as unknown as undefined,
      table_number: null as unknown as undefined,
    });
    const party = makeParty({
      address_line_1: null as unknown as undefined,
      postal_code: null as unknown as undefined,
    });

    const fields = dataRow(guest, [party]).split(",");
    expect(fields[1]).toBe("");
    expect(fields[9]).toBe("");
    expect(fields[16]).toBe("");
    expect(fields[20]).toBe("");
    expect(dataRow(guest, [party])).not.toContain("null");
  });

  it("joins party data by id and preserves guest order", () => {
    const first = makeGuest({ id: "g2", party_id: "p2", full_name: "First" });
    const second = makeGuest({ id: "g1", party_id: "p1", full_name: "Second" });
    const rows = guestsCsvContent(
      [first, second],
      [makeParty(), makeParty({ id: "p2", name: "Party Two" })],
    )
      .split("\r\n")
      .slice(1);

    expect(rows[0]).toContain("First");
    expect(rows[0]).toContain("Party Two");
    expect(rows[1]).toContain("Second");
    expect(rows[1]).toContain("The Smiths");
  });

  it("escapes commas, quotes, and line breaks per RFC 4180", () => {
    const row = dataRow(
      makeGuest({
        full_name: 'Smith, "Ada"',
        dietary_restrictions: "No\nnuts",
      }),
    );
    expect(row).toContain('"Smith, ""Ada"""');
    expect(row).toContain('"No\nnuts"');
  });

  it("neutralizes spreadsheet formulas and preserves leading-zero postal codes", () => {
    const row = dataRow(makeGuest({ full_name: "=1+1" }), [
      makeParty({ postal_code: "01234" }),
    ]);
    expect(row.startsWith("'=1+1,")).toBe(true);
    expect(row).toContain(",'01234,");
  });

  it("throws rather than silently emitting incomplete party columns", () => {
    expect(() => guestsCsvContent([makeGuest()], [])).toThrow(
      "Party p1 is unavailable for CSV export",
    );
  });
});

describe("guestsCsvFilename", () => {
  it("stamps the local date", () => {
    expect(guestsCsvFilename(new Date(2026, 0, 5))).toBe(
      "guests-2026-01-05.csv",
    );
  });
});

describe("downloadGuestsCsv", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (URL as Partial<typeof URL>).createObjectURL;
    delete (URL as Partial<typeof URL>).revokeObjectURL;
  });

  it("downloads a BOM-prefixed CSV with the dated filename", async () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn().mockReturnValue("blob:guest-csv");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const appendChild = vi.spyOn(document.body, "appendChild");

    downloadGuestsCsv([makeGuest()], [makeParty()], new Date(2026, 6, 1));

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("text/csv;charset=utf-8");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    const anchor = appendChild.mock.calls[0][0] as HTMLAnchorElement;
    expect(anchor.download).toBe("guests-2026-07-01.csv");

    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:guest-csv");
  });
});
