/**
 * Returns a letters-only per-run unique suffix for entity names.
 *
 * The admin guest search also matches phones by the digits in the search
 * term, so a suffix containing digits would drag every phone-bearing guest
 * left by earlier runs into a name search and break row isolation. The
 * timestamp is rendered in base 26 with each digit mapped to a-z, which is
 * injective, so the suffix stays unique per run and never contains digits.
 */
export function runStamp(): string {
  return [...Date.now().toString(26)]
    .map((c) => String.fromCharCode(97 + parseInt(c, 26)))
    .join("");
}
