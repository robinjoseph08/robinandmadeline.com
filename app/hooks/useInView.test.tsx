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

  it("reveals once the observed element intersects", () => {
    let fire: (entries: { isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(
          callback: (entries: { isIntersecting: boolean }[]) => void,
        ) {
          fire = callback;
        }
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );

    render(<Probe />);
    expect(screen.getByTestId("probe")).toHaveTextContent("out");

    act(() => fire([{ isIntersecting: true }]));
    expect(screen.getByTestId("probe")).toHaveTextContent("in");
  });
});
