import { parsePhoneNumberFromString } from "libphonenumber-js";

/**
 * Formats a stored phone number for display. The backend normalizes and stores
 * canonical E.164 (e.g. "+14155552671"); this renders it the friendly way:
 * national format for US numbers ("(415) 555-2671") and international format for
 * everyone else ("+44 20 7946 0958"). Anything that does not parse (a blank, or
 * legacy data saved before E.164 normalization) is returned unchanged so the
 * field still shows whatever is there.
 */
export function formatPhone(value: string): string {
  if (!value) return "";
  const parsed = parsePhoneNumberFromString(value);
  if (!parsed) return value;
  return parsed.country === "US"
    ? parsed.formatNational()
    : parsed.formatInternational();
}
