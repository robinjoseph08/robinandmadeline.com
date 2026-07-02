/**
 * Client-side CSV export of the admin party list, for handing a mailing list to
 * a print shop. The Parties page already holds the full result (ListParties is
 * unpaginated) in the filtered, sorted order the admin sees, and every field the
 * export needs already rides on PartyResponse, so the CSV is built and
 * downloaded in the browser rather than through a new non-JSON API endpoint.
 * This mirrors the calendar-file download in calendar.ts (downloadICS).
 */

import type { InvitationType } from "@/types/generated/models";
import type { PartyResponse } from "@/types/generated/parties";

interface PartyCsvColumn {
  label: string;
  value: (party: PartyResponse) => string;
}

// The invitation type rendered as the title-case label the rest of the admin UI
// shows (the stored enum is lowercase). Keyed by the generated InvitationType
// union so a new backend value is a compile error here, not a silent lowercase
// cell that disagrees with the title-case column header.
const INVITATION_TYPE_LABELS: Record<InvitationType, string> = {
  physical: "Physical",
  digital: "Digital",
};

// The domestic mailing country. Matched case-insensitively (trimmed), mirroring
// models.Party.mailedToUS in Go.
const DOMESTIC_COUNTRY = "United States";

// Formats the country the way a printer expects it on the envelope: a domestic
// (US) address carries no country line, so it is left blank, and every other
// country is upper-cased, the convention for the destination country on
// international mail. A blank/absent country stays blank.
function formatCountry(country: string | undefined): string {
  const trimmed = country?.trim() ?? "";
  if (trimmed.toLowerCase() === DOMESTIC_COUNTRY.toLowerCase()) {
    return "";
  }
  return trimmed.toUpperCase();
}

// The export columns, in order: the addressee name and mailing address a printer
// needs for the envelopes, then the invitation type so a digital party (which
// typically has no mailing address) is easy to spot and drop if the list was
// exported without filtering to physical first. The nullable address fields
// render as an empty cell when absent.
export const PARTY_CSV_COLUMNS: PartyCsvColumn[] = [
  { label: "Name", value: (p) => p.name },
  { label: "Address Line 1", value: (p) => p.address_line_1 ?? "" },
  { label: "Address Line 2", value: (p) => p.address_line_2 ?? "" },
  { label: "City", value: (p) => p.city ?? "" },
  { label: "State/Province", value: (p) => p.state_or_province ?? "" },
  { label: "Postal Code", value: (p) => p.postal_code ?? "" },
  { label: "Country", value: (p) => formatCountry(p.country) },
  {
    label: "Invitation Type",
    value: (p) => INVITATION_TYPE_LABELS[p.invitation_type],
  },
];

// RFC 4180: a field only needs quoting when it contains a double quote, a comma,
// or a line break. Then it is wrapped in double quotes and every embedded quote
// is doubled. Everything else is emitted verbatim.
function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// Joins one record's already-stringified fields into a CSV row.
function csvRow(fields: string[]): string {
  return fields.map(escapeCsvField).join(",");
}

/**
 * Renders the parties as CSV text: a header row of column labels followed by one
 * row per party, each field escaped per RFC 4180 and rows joined with CRLF. Kept
 * pure (no BOM, no DOM) so the download wrapper and the tests share it.
 */
export function partiesCsvContent(parties: PartyResponse[]): string {
  const header = csvRow(PARTY_CSV_COLUMNS.map((column) => column.label));
  const rows = parties.map((party) =>
    csvRow(PARTY_CSV_COLUMNS.map((column) => column.value(party))),
  );
  return [header, ...rows].join("\r\n");
}

// Zero-pads a month or day to two digits for the filename date stamp.
function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * A dated, filesystem-friendly download name, e.g. "parties-2026-07-01.csv". The
 * date is passed in rather than read from the clock so the name is deterministic
 * and testable; it uses the local date so the stamp matches the day the admin is
 * looking at, not UTC.
 */
export function partiesCsvFilename(date: Date): string {
  const stamp = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  return `parties-${stamp}.csv`;
}

/**
 * Builds the CSV in memory and triggers a browser download of it, mirroring
 * downloadICS in calendar.ts. A UTF-8 BOM is prepended so Excel opens the file
 * as UTF-8 and renders accented names correctly.
 */
export function downloadPartiesCsv(parties: PartyResponse[], date: Date): void {
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom, partiesCsvContent(parties)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = partiesCsvFilename(date);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Same reasoning as downloadICS: revoking in the same task as the click has
  // intermittently cancelled the download in Safari, so keep the blob URL alive
  // long enough for any browser to have started reading it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
