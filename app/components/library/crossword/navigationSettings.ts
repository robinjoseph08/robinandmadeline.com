/*
 * Grid navigation settings, vendored from github.com/crisscrosscx/solve
 * (app/components/library/Grid/navigationSettings.ts). Constants for now;
 * upstream plans to make them user preferences.
 */

/**
 * When true, typing the last letter of a word will NOT automatically
 * advance to the next word. The solver must press Tab to move on.
 */
export const NAV_MANUAL_WORD_ADVANCE = true;

/**
 * When true, typing will skip over already-filled squares.
 * Example: in "__LL_", typing "H" then "E" at position 0 jumps to position 4,
 * skipping the filled "L"s.
 */
export const NAV_SKIP_FILLED_SQUARES = true;

/**
 * When true, after filling the last blank square in a word that still has
 * other blank squares, the cursor jumps back to the first blank in the word.
 */
export const NAV_JUMP_TO_FIRST_BLANK_ON_COMPLETE = true;

/**
 * When true, backspace can move into the previous word.
 * When false, backspace at the first letter of a word only clears that letter
 * (if filled) but won't move the selection backward into the previous word.
 */
export const NAV_BACKSPACE_ACROSS_WORDS = true;
