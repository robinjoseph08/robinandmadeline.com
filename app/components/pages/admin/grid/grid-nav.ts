/**
 * Keyboard navigation helper for the editable admin grids.
 *
 * The grids deliberately lean on native tabbing for left/right movement (DOM
 * order matches visual column order, so Tab and Shift+Tab already walk the cells
 * and wrap across rows). This adds the one spreadsheet behavior the browser does
 * not give for free: Enter committing the current cell and moving focus straight
 * down to the same column in the next row. It works by DOM traversal from the
 * focused control, so no per-cell coordinate registry is needed and the grids
 * stay plain <table>s.
 */

// Controls a grid cell may hand focus to. Disabled controls are excluded (a
// locked checkbox cannot take an edit, so Enter keeps walking past it), as are
// deliberately unfocusable elements (negative tabindex) and focusable-but-not-
// editable wrappers that opt out via data-grid-nav-skip (the locked primary's
// tooltip span).
const FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"]):not(:disabled)',
  "button:not(:disabled)",
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  '[tabindex]:not([tabindex="-1"]):not([data-grid-nav-skip])',
].join(", ");

/**
 * Focuses the focusable control in the same column one row below the cell
 * containing `el`. Read-only columns (cells with no focusable control) are
 * skipped, so Enter keeps walking down until it finds an editable cell or runs
 * out of rows. Returns whether focus moved.
 */
export function focusCellBelow(el: HTMLElement): boolean {
  const cell = el.closest("td, th");
  const row = el.closest("tr");
  if (!cell || !row) return false;

  const colIndex = Array.from(row.children).indexOf(cell);
  let sibling = row.nextElementSibling;

  while (sibling) {
    const targetCell = sibling.children[colIndex] as HTMLElement | undefined;
    const control = targetCell?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    if (control) {
      control.focus();
      // Selecting the text makes the next keystroke overwrite, the way a
      // spreadsheet does when you arrow into a filled cell.
      if (control instanceof HTMLInputElement && control.type !== "checkbox") {
        control.select();
      }
      return true;
    }
    sibling = sibling.nextElementSibling;
  }
  return false;
}
