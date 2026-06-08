/**
 * Keyboard navigation helpers for the editable admin grids.
 *
 * The grids deliberately lean on native tabbing for left/right movement (DOM
 * order matches visual column order, so Tab and Shift+Tab already walk the cells
 * and wrap across rows). These helpers add the one spreadsheet behavior the
 * browser does not give for free: Enter committing the current cell and moving
 * focus straight down to the same column in the next row. They work by DOM
 * traversal from the focused control, so no per-cell coordinate registry is
 * needed and the grids stay plain <table>s.
 */

// Controls a grid cell may hand focus to. The :not negative-tabindex guard skips
// elements that are deliberately unfocusable.
const FOCUSABLE_SELECTOR =
  'input:not([type="hidden"]), button, textarea, select, [tabindex]:not([tabindex="-1"])';

/**
 * Focuses the focusable control in the same column `rowOffset` rows away from the
 * cell containing `el` (positive is downward). Read-only columns (cells with no
 * focusable control) are skipped, so Enter keeps walking until it finds an
 * editable cell or runs out of rows. Returns whether focus moved.
 */
function focusCellInDirection(el: HTMLElement, rowOffset: 1 | -1): boolean {
  const cell = el.closest("td, th");
  const row = el.closest("tr");
  if (!cell || !row) return false;

  const colIndex = Array.from(row.children).indexOf(cell);
  let sibling =
    rowOffset === 1 ? row.nextElementSibling : row.previousElementSibling;

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
    sibling =
      rowOffset === 1
        ? sibling.nextElementSibling
        : sibling.previousElementSibling;
  }
  return false;
}

/** Focuses the same column one row below, skipping read-only cells. */
export function focusCellBelow(el: HTMLElement): boolean {
  return focusCellInDirection(el, 1);
}

/** Focuses the same column one row above, skipping read-only cells. */
export function focusCellAbove(el: HTMLElement): boolean {
  return focusCellInDirection(el, -1);
}
