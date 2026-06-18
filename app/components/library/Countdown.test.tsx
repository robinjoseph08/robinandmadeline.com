import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import Countdown from "@/components/library/Countdown";

// The wedding moment, 2027-04-10 17:00 Central (CDT, UTC-5), as the absolute
// UTC instant the component counts toward. Setting the fake clock to UTC
// instants keeps these tests independent of the runner's local timezone.
const TARGET_UTC = "2027-04-10T22:00:00.000Z";

function cell(key: string): string {
  return screen.getByTestId(`countdown-${key}`).textContent ?? "";
}

describe("Countdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down to the wedding before it happens", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    // Exactly 2d 3h 4m 5s before the target; pins the unit decomposition so a
    // missed subtraction (e.g. hours overflowing past 23) would be caught.
    vi.setSystemTime(new Date("2027-04-08T18:55:55.000Z"));

    render(<Countdown />);

    expect(screen.getByText("Counting down to")).toBeInTheDocument();
    expect(screen.queryByText("Married since")).not.toBeInTheDocument();
    expect(cell("days")).toBe("2");
    expect(cell("hours")).toBe("3");
    expect(cell("minutes")).toBe("4");
    expect(cell("seconds")).toBe("5");
  });

  it("counts up after the wedding with the celebratory label", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    // 3d 1h 2m 30s after the target. The positive elapsed values guard against
    // a direction inversion that would otherwise show negative numbers.
    vi.setSystemTime(new Date("2027-04-13T23:02:30.000Z"));

    render(<Countdown />);

    expect(screen.getByText("Married since")).toBeInTheDocument();
    expect(screen.queryByText("Counting down to")).not.toBeInTheDocument();
    expect(cell("days")).toBe("3");
    expect(cell("hours")).toBe("1");
    expect(cell("minutes")).toBe("2");
    expect(cell("seconds")).toBe("30");
  });

  it("treats the exact wedding moment as married, all units zero", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date(TARGET_UTC));

    render(<Countdown />);

    // The boundary is inclusive (now >= target), so it reads as married.
    expect(screen.getByText("Married since")).toBeInTheDocument();
    expect(screen.queryByText("Counting down to")).not.toBeInTheDocument();
    for (const key of ["days", "hours", "minutes", "seconds"]) {
      expect(cell(key)).toBe("0");
    }
  });

  it("ticks every second from the running interval", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2027-04-08T18:55:55.000Z"));

    render(<Countdown />);

    expect(cell("seconds")).toBe("5");
    // One second closer to the target drops the seconds reading.
    act(() => vi.advanceTimersByTime(1000));
    expect(cell("seconds")).toBe("4");
  });
});
