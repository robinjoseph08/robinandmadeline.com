import { useEffect, useRef, useState } from "react";

/** True when the OS asks for reduced motion (guarded for non-browser/test envs). */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Reveal-on-scroll helper. Attach the returned `ref` to an element; `inView`
 * flips to true the first time it scrolls into view and then stays true, so the
 * reveal plays once. When the OS prefers reduced motion, or IntersectionObserver
 * is unavailable (e.g. jsdom in tests), it reports visible immediately, so the
 * content is never left hidden and no animation runs.
 */
export function useInView<T extends HTMLElement = HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(prefersReducedMotion);

  useEffect(() => {
    if (inView) return;
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      // Trip slightly before the element's top edge so it reveals as it rises in.
      { rootMargin: "0px 0px -12% 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [inView]);

  return { ref, inView };
}
