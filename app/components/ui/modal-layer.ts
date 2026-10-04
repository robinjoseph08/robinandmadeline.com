import { createContext } from "react";

/**
 * True for anything rendered inside a modal Dialog or Sheet's content. A modal
 * Radix Dialog blocks wheel and touch scrolling everywhere outside its content,
 * and a Popover portals its content to <body>, i.e. outside the dialog, so a
 * scrollable popover (a combobox list) opened inside a dialog cannot scroll.
 * Popover reads this to go modal itself in that case: its own scroll lock then
 * stacks on top of the dialog's and allows scrolling within the popover.
 * DialogContent and SheetContent provide it unconditionally, which assumes the
 * dialog is modal (the Radix default, and every dialog in the app today).
 */
export const ModalLayerContext = createContext(false);
