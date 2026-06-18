import { useEffect, useState } from "react";

import { WEDDING } from "@/components/pages/home-content";

// 5:00 PM Central (CDT, UTC-5) on the wedding day.
const TARGET = new Date("2027-04-10T17:00:00-05:00").getTime();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Remaining {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  past: boolean;
}

function remaining(now: number): Remaining {
  const past = now >= TARGET;
  let delta = Math.abs(TARGET - now);
  const days = Math.floor(delta / DAY);
  delta -= days * DAY;
  const hours = Math.floor(delta / HOUR);
  delta -= hours * HOUR;
  const minutes = Math.floor(delta / MINUTE);
  delta -= minutes * MINUTE;
  const seconds = Math.floor(delta / SECOND);
  return { days, hours, minutes, seconds, past };
}

const UNITS = [
  { key: "days", label: "Days" },
  { key: "hours", label: "Hours" },
  { key: "minutes", label: "Minutes" },
  { key: "seconds", label: "Seconds" },
] as const;

/**
 * A live countdown to the wedding (5pm Central on the wedding day). Once the
 * moment passes it counts up instead, so the page keeps celebrating.
 */
export default function Countdown() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const time = remaining(now);

  return (
    <section
      aria-label="Countdown to the wedding"
      className="mt-16 text-center"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-ink-muted">
        {time.past ? "Married since" : "Counting down to"}
      </p>
      <p className="mt-3 font-display text-2xl font-normal text-ink sm:text-3xl">
        {WEDDING.dateText}
      </p>
      <div className="mx-auto mt-8 grid max-w-xl grid-cols-4 gap-3 sm:gap-5">
        {UNITS.map((unit) => (
          <div
            className="rounded-2xl border border-line bg-surface px-2 py-5 shadow-sm sm:py-6"
            key={unit.key}
          >
            <div
              className="font-display text-3xl tabular-nums text-rose sm:text-5xl"
              data-testid={`countdown-${unit.key}`}
            >
              {time[unit.key]}
            </div>
            <div className="mt-1 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-ink-muted sm:text-xs">
              {unit.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
