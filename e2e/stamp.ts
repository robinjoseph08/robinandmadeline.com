/**
 * Returns a letters-only per-run unique suffix for entity names.
 *
 * The admin guest search now gates its phone clause on the term looking like a
 * phone number (only digits and phone formatting, with at least 3 digits), so a
 * letters-bearing name search no longer matches phones and a digit in the suffix
 * is harmless. We keep the suffix letters-only anyway so isolation never depends
 * on that gate: the timestamp is rendered in base 26 with each digit mapped to
 * a-z, which is injective, so the suffix stays unique per run and never contains
 * digits.
 */
export function runStamp(): string {
  return [...Date.now().toString(26)]
    .map((c) => String.fromCharCode(97 + parseInt(c, 26)))
    .join("");
}
