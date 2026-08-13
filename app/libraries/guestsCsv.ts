import {
  INVITATION_TYPE_OPTIONS,
  labelFor,
  RELATION_OPTIONS,
  SIDE_OPTIONS,
} from "@/components/pages/admin/parties/options";
import { formatPhone } from "@/libraries/phone";
import type { GuestListItem, PartyResponse } from "@/types/generated/parties";

interface GuestCsvRecord {
  guest: GuestListItem;
  party: PartyResponse;
}

interface GuestCsvColumn {
  label: string;
  value: (record: GuestCsvRecord) => string;
}

function optional(value: string | number | null | undefined): string {
  return value == null ? "" : String(value);
}

function yesNo(value: boolean): string {
  return value ? "Yes" : "No";
}

function phone(value: string | null | undefined): string {
  const raw = optional(value);
  const formatted = formatPhone(raw);
  // Canonical numbers become a punctuated display value. Preserve an old,
  // unparseable digit-only value as spreadsheet text rather than letting a
  // spreadsheet drop leading zeroes or round it.
  return formatted === raw && /^\d+$/.test(raw) ? `'${raw}` : formatted;
}

// Preserve leading zeroes when a postal code is opened in spreadsheet apps.
function postalCode(value: string | undefined): string {
  const text = optional(value);
  return /^0\d/.test(text) ? `'${text}` : text;
}

// Mirrors the data columns on the flat guest grid. Subscribed and the party's
// derived Info status are intentionally excluded, as are the non-data Actions
// column. Party values are repeated on every guest row so the file is useful as
// a standalone flat list.
export const GUEST_CSV_COLUMNS: GuestCsvColumn[] = [
  { label: "Name", value: ({ guest }) => guest.full_name },
  { label: "Email", value: ({ guest }) => optional(guest.email) },
  { label: "Phone", value: ({ guest }) => phone(guest.phone) },
  { label: "Tags", value: ({ guest }) => guest.tags.join("; ") },
  { label: "Child", value: ({ guest }) => yesNo(guest.is_child) },
  { label: "Drinking", value: ({ guest }) => yesNo(guest.is_drinking) },
  {
    label: "Placeholder",
    value: ({ guest }) => optional(guest.placeholder_text),
  },
  { label: "Primary", value: ({ guest }) => yesNo(guest.is_primary) },
  {
    label: "Dietary",
    value: ({ guest }) => optional(guest.dietary_restrictions),
  },
  { label: "Table", value: ({ guest }) => optional(guest.table_number) },
  { label: "Seat", value: ({ guest }) => optional(guest.seat_number) },
  { label: "Party", value: ({ party }) => party.name },
  {
    label: "Side",
    value: ({ party }) => labelFor(SIDE_OPTIONS, party.side),
  },
  {
    label: "Relation",
    value: ({ party }) => labelFor(RELATION_OPTIONS, party.relation),
  },
  { label: "Circle", value: ({ party }) => party.circle.join("; ") },
  {
    label: "Invitation",
    value: ({ party }) =>
      labelFor(INVITATION_TYPE_OPTIONS, party.invitation_type),
  },
  {
    label: "Address Line 1",
    value: ({ party }) => optional(party.address_line_1),
  },
  {
    label: "Address Line 2",
    value: ({ party }) => optional(party.address_line_2),
  },
  { label: "City", value: ({ party }) => optional(party.city) },
  {
    label: "State/Province",
    value: ({ party }) => optional(party.state_or_province),
  },
  {
    label: "Postal Code",
    value: ({ party }) => postalCode(party.postal_code),
  },
  { label: "Country", value: ({ party }) => optional(party.country) },
  { label: "RSVP Code", value: ({ party }) => optional(party.rsvp_code) },
];

function escapeCsvField(value: string): string {
  // Spreadsheet apps execute cells beginning with these characters as formulas.
  // Prefix them with an apostrophe so guest-entered text stays text and values
  // such as E.164 phone numbers retain their leading plus sign in Excel.
  const safeValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`;
  }
  return safeValue;
}

function csvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

/** Builds RFC 4180 CSV for guests in their current filtered and sorted order. */
export function guestsCsvContent(
  guests: GuestListItem[],
  parties: PartyResponse[],
): string {
  const partyById = new Map(parties.map((party) => [party.id, party]));
  const header = csvRow(GUEST_CSV_COLUMNS.map((column) => column.label));
  const rows = guests.map((guest) => {
    const party = partyById.get(guest.party_id);
    if (!party) {
      throw new Error(`Party ${guest.party_id} is unavailable for CSV export`);
    }
    const record = { guest, party };
    return csvRow(GUEST_CSV_COLUMNS.map((column) => column.value(record)));
  });
  return [header, ...rows].join("\r\n");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function guestsCsvFilename(date: Date): string {
  const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `guests-${stamp}.csv`;
}

/** Downloads the guest CSV with a UTF-8 BOM for Excel compatibility. */
export function downloadGuestsCsv(
  guests: GuestListItem[],
  parties: PartyResponse[],
  date: Date,
): void {
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom, guestsCsvContent(guests, parties)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = guestsCsvFilename(date);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
