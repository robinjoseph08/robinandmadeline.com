import { useEffect, useState } from "react";

const CUSTOM_KEYBOARD_QUERY = "(max-width: 767px), (any-pointer: coarse)";

function matchesCustomKeyboardMode(): boolean {
  if (typeof window.matchMedia !== "function") {
    // Unit tests and older embedded browsers without matchMedia get the safer
    // touch-first path. A custom keyboard is usable with mouse or touch, while
    // suppressing it could leave a touch-only guest with no input method.
    return true;
  }
  return window.matchMedia(CUSTOM_KEYBOARD_QUERY).matches;
}

/** Use the custom crossword keyboard on narrow screens and touch hardware. */
export default function useCustomKeyboard(): boolean {
  const [enabled, setEnabled] = useState(matchesCustomKeyboardMode);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia(CUSTOM_KEYBOARD_QUERY);
    const update = () => setEnabled(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return enabled;
}
