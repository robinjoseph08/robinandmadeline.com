import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useInView } from "@/hooks/useInView";

/** Renders the hook's state so the tests can assert on it through the DOM. */
function Probe() {
  const { ref, inView } = useInView<HTMLDivElement>();
  return (
    <div data-testid="probe" ref={ref}>
      {inView ? "in" : "out"}
    </div>
  );
}

describe("useInView", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reveals immediately when IntersectionObserver is unavailable", () => {
    vi.stubGlobal("IntersectionObserver", undefined);

    render(<Probe />);

    expect(screen.getByTestId("probe")).toHaveTextContent("in");
  });

  it("reveals immediately, without observing, when reduced motion is preferred", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const observe = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe = observe;
        disconnect() {}
        unobserve() {}
      },
    );

    render(<Probe />);

    expect(screen.getByTestId("probe")).toHaveTextContent("in");
    expect(observe).not.toHaveBeenCalled();
  });

  it("observes the element and reveals once it intersects", () => {
    let fire: (entries: { isIntersecting: boolean }[]) => void = () => {};
    let options: IntersectionObserverInit | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
          opts?: IntersectionObserverInit,
        ) {
          fire = callback;
          options = opts;
        }
        observe = observe;
        disconnect = disconnect;
        unobserve() {}
      },
    );

    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("out");
    expect(observe).toHaveBeenCalledTimes(1);
    expect(options).toEqual({ rootMargin: "0px 0px -12% 0px" });

    // A non-intersecting entry must not reveal it.
    act(() => fire([{ isIntersecting: false }]));
    expect(screen.getByTestId("probe")).toHaveTextContent("out");

    // Once it intersects it reveals and disconnects (reveal once, then stop).
    act(() => fire([{ isIntersecting: true }]));
    expect(screen.getByTestId("probe")).toHaveTextContent("in");
    expect(disconnect).toHaveBeenCalled();
  });
});
