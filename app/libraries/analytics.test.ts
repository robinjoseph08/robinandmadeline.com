import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOKEN_STORAGE_KEY } from "@/libraries/admin-api";
import {
  forgetVisitor,
  identifyVisitor,
  trackEvent,
} from "@/libraries/analytics";

const send = (payload: Record<string, unknown>) =>
  window.umamiBeforeSend?.("event", payload);

describe("analytics", () => {
  beforeEach(() => {
    localStorage.clear();
    // Clears what the module remembers about this page load's sends.
    send({});
  });

  afterEach(() => {
    delete window.umami;
  });

  it("names events by category and action", () => {
    const track = vi.fn();
    window.umami = { track, identify: vi.fn() };

    trackEvent("FAQ", "open", { question: "Parking?" });

    expect(track).toHaveBeenCalledWith("FAQ: open", { question: "Parking?" });
  });

  it("does nothing without the tracker", () => {
    expect(() => trackEvent("FAQ", "open")).not.toThrow();
  });

  it("leaves an unidentified visitor's events alone", () => {
    expect(send({ url: "/faq" })).toEqual({ url: "/faq" });
  });

  it("labels events once a visitor is identified, until forgotten", () => {
    identifyVisitor("Amanda Example");
    expect(send({ url: "/faq" })).toEqual({
      url: "/faq",
      id: "Amanda Example",
    });

    forgetVisitor();
    expect(send({ url: "/faq" })).toEqual({ url: "/faq" });
  });

  it("announces a visitor once, so Umami can stitch their sessions", () => {
    const identify = vi.fn(() => Promise.resolve());
    window.umami = { track: vi.fn(), identify };
    identifyVisitor("Amanda Example");

    send({ url: "/faq" });
    send({ url: "/travel" });

    expect(identify).toHaveBeenCalledTimes(1);
    expect(identify).toHaveBeenCalledWith("Amanda Example");
  });

  it("does not announce from the tracker's own identify send", () => {
    const identify = vi.fn(() => Promise.resolve());
    window.umami = { track: vi.fn(), identify };
    identifyVisitor("Amanda Example");

    expect(window.umamiBeforeSend?.("identify", {})).toEqual({
      id: "Amanda Example",
    });

    expect(identify).not.toHaveBeenCalled();
  });

  it("drops a name the tracker still holds after forgetting", () => {
    expect(send({ url: "/faq", id: "Amanda Example" })?.id).toBeUndefined();
  });

  it("records the page again when the name arrives after the pageview", () => {
    const track = vi.fn();
    window.umami = { track, identify: vi.fn(() => Promise.resolve()) };
    send({ url: location.href });

    identifyVisitor("Amanda Example");

    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith();
  });

  it("does not record the page again for a name it already sent", () => {
    const track = vi.fn();
    window.umami = { track, identify: vi.fn(() => Promise.resolve()) };
    identifyVisitor("Amanda Example");
    send({ url: location.href });
    track.mockClear();

    identifyVisitor("Amanda Example");

    expect(track).not.toHaveBeenCalled();
  });

  it("leaves it to a pageview that's still on its way after navigating", () => {
    const track = vi.fn();
    window.umami = { track, identify: vi.fn(() => Promise.resolve()) };
    send({ url: "https://www.robinandmadeline.com/some-earlier-page" });

    identifyVisitor("Amanda Example");

    expect(track).not.toHaveBeenCalled();
  });

  it("fits the name in Umami's distinct ID column", () => {
    identifyVisitor("x".repeat(80));
    expect(send({})).toEqual({ id: "x".repeat(50) });
  });

  it("stops using an older label once the browser signs in to the admin", () => {
    identifyVisitor("Amanda Example");
    localStorage.setItem(TOKEN_STORAGE_KEY, "admin-jwt");

    expect(send({ url: "/faq" })?.id).toBeUndefined();
  });

  it("does not label a browser signed in to the admin", () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "admin-jwt");

    identifyVisitor("Amanda Example");

    expect(send({ url: "/i/token" })).toEqual({ url: "/i/token" });
  });
});
