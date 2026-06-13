/*
 * Grid navigation settings, vendored from github.com/crisscrosscx/solve
 * (app/components/library/Grid/navigationSettings.ts). Upstream ships these
 * as constants and plans to make them user preferences; this site has done
 * that, so they are now a settings object the Grid takes as a prop (the
 * gear-menu settings dialog edits them; see settings.ts for persistence).
 * The defaults preserve the original constants' values, so the grid behaves
 * exactly as before until a solver changes something.
 */

/** How the cursor behaves while typing and moving around the grid. */
export interface NavigationSettings {
  /**
   * What an arrow key pressed against the current typing direction does
   * after flipping the direction: "stay" leaves the cursor on the same
   * square, "move" also moves one square the way the arrow points.
   */
  arrowKeyAfterDirectionChange: "stay" | "move";
  /**
   * What the space bar does: "toggle" flips between across and down,
   * "clear" erases the current square and moves to the next one in the word.
   */
  spacebarBehavior: "toggle" | "clear";
  /**
   * When true, backspace on an empty square at the first letter of a word
   * moves into the previous word. When false it stops at the word boundary.
   */
  backspaceIntoPreviousWord: boolean;
  /** When true, typing skips over already-filled squares within a word. */
  skipFilledSquares: boolean;
  /**
   * When true, after filling the last blank square of a word that still has
   * other blank squares, the cursor jumps back to the word's first blank.
   */
  jumpBackToFirstBlank: boolean;
  /**
   * When true, finishing a word advances to the next unfinished word's clue.
   * When false the cursor stays put and the solver moves on with Tab. Only
   * applies when the cursor is not jumping back to a blank in the same word.
   */
  jumpToNextClue: boolean;
}

export const DEFAULT_NAVIGATION_SETTINGS: NavigationSettings = {
  arrowKeyAfterDirectionChange: "stay",
  spacebarBehavior: "toggle",
  backspaceIntoPreviousWord: true,
  skipFilledSquares: true,
  jumpBackToFirstBlank: true,
  jumpToNextClue: false,
};
