import { AsYouType } from "libphonenumber-js";
import {
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type RefObject,
} from "react";

/**
 * Formats a phone number as the user types, via libphonenumber-js's AsYouType
 * against the US default region: a bare number groups as "(123) 456-7890", a
 * number written with the US "1" country code or in full international "+…" form
 * is grouped in its own convention, and a value too long or not yet a valid
 * number is left as the digits entered rather than forced into US grouping. The
 * backend still normalizes to E.164 on save, so callers seed a display-formatted
 * value (formatPhone) and submit whatever this leaves in the field.
 */
function formatPhoneInput(value: string): string {
  return new AsYouType("US").input(value);
}

/** Counts the digit characters in a string. */
function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

/**
 * The caret offset in `formatted` that sits just after its `n`th digit. After a
 * reformat we use this to keep the caret beside the same digit the user was
 * editing, instead of letting it snap to the end.
 */
function caretAfterNthDigit(formatted: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i += 1) {
    if (/\d/.test(formatted[i])) {
      seen += 1;
      if (seen === n) return i + 1;
    }
  }
  return formatted.length;
}

/**
 * Wires caret-preserving phone formatting onto a controlled text input.
 * Inserting the grouping characters shifts every later position, so a controlled
 * input would restore a now-stale caret offset and scatter the user's edits.
 * Instead we count the digits before the caret, reformat, and put the caret back
 * beside that same digit once React has committed the new value, so typing,
 * deleting, and editing mid-number all land where the user expects.
 *
 * The caller owns the input ref (so it stays a plain `ref={ref}` attachment) and
 * passes it in; the returned onChange formats the typed value and hands the
 * result to `onValue`. Shared by the standalone PhoneField and the admin grid's
 * phone cell.
 */
export function usePhoneFormatting(
  ref: RefObject<HTMLInputElement | null>,
  onValue: (value: string) => void,
) {
  // Where to put the caret once the reformatted value lands in the DOM. It's
  // computed in onChange (below) and reapplied here, after the commit, to
  // override the stale offset the controlled input would otherwise keep.
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && caret.current !== null && document.activeElement === el) {
      el.setSelectionRange(caret.current, caret.current);
    }
    caret.current = null;
  });

  return function onChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const selection = e.target.selectionStart ?? raw.length;
    const formatted = formatPhoneInput(raw);
    // An unchanged string — a no-op edit, or an international number we pass
    // through — keeps the caret put; otherwise anchor it to the same digit it
    // sat beside before the grouping characters moved everything.
    caret.current =
      formatted === raw
        ? selection
        : caretAfterNthDigit(formatted, digitCount(raw.slice(0, selection)));
    onValue(formatted);
  };
}
