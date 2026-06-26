import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useAdminPageTitle, usePageTitle } from "./usePageTitle";

const APP_NAME = "Robin & Madeline";

afterEach(() => {
  document.title = "";
});

describe("usePageTitle", () => {
  it("joins the page title and app name with a middot", () => {
    renderHook(() => usePageTitle("Schedule"));
    expect(document.title).toBe(`Schedule · ${APP_NAME}`);
  });

  it("shows just the app name when no title is given", () => {
    renderHook(() => usePageTitle());
    expect(document.title).toBe(APP_NAME);
  });

  it("shows just the app name for an empty title (e.g. data still loading)", () => {
    renderHook(() => usePageTitle(""));
    expect(document.title).toBe(APP_NAME);
  });

  it("updates the title when the page title changes", () => {
    const { rerender } = renderHook(({ title }) => usePageTitle(title), {
      initialProps: { title: undefined as string | undefined },
    });
    expect(document.title).toBe(APP_NAME);

    rerender({ title: "Amanda's Party" });
    expect(document.title).toBe(`Amanda's Party · ${APP_NAME}`);
  });

  it("restores the previous title on unmount", () => {
    document.title = "Existing";
    const { unmount } = renderHook(() => usePageTitle("Schedule"));
    expect(document.title).toBe(`Schedule · ${APP_NAME}`);

    unmount();
    expect(document.title).toBe("Existing");
  });
});

describe("useAdminPageTitle", () => {
  it("inserts an Admin segment between the page title and app name", () => {
    renderHook(() => useAdminPageTitle("Guests"));
    expect(document.title).toBe(`Guests · Admin · ${APP_NAME}`);
  });

  it("falls back to the Admin segment and app name when no title is given", () => {
    renderHook(() => useAdminPageTitle());
    expect(document.title).toBe(`Admin · ${APP_NAME}`);
  });
});
