import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSortDefault } from "./useSortDefault";

const KEY = "test:defaultSort";
const FIELDS = new Set(["name", "date_added", "side"]);

beforeEach(() => {
  localStorage.clear();
});

describe("useSortDefault", () => {
  it("returns null when nothing is stored", () => {
    const { result } = renderHook(() => useSortDefault(KEY, FIELDS));
    expect(result.current[0]).toBeNull();
  });

  it("reads and parses a stored default", () => {
    localStorage.setItem(KEY, "name:asc,side:desc");
    const { result } = renderHook(() => useSortDefault(KEY, FIELDS));
    expect(result.current[0]).toEqual([
      { field: "name", direction: "asc" },
      { field: "side", direction: "desc" },
    ]);
  });

  it("degrades to null when the stored default references an unknown field", () => {
    // A default saved before a field was removed must not throw or leak through.
    localStorage.setItem(KEY, "name:asc,bogus:asc");
    const { result } = renderHook(() => useSortDefault(KEY, FIELDS));
    expect(result.current[0]).toBeNull();
  });

  it("saves a default to localStorage and exposes it", () => {
    const { result } = renderHook(() => useSortDefault(KEY, FIELDS));
    act(() => {
      result.current[1]([{ field: "name", direction: "desc" }]);
    });
    expect(localStorage.getItem(KEY)).toBe("name:desc");
    expect(result.current[0]).toEqual([{ field: "name", direction: "desc" }]);
  });

  it("clears the stored default when saving an empty sort", () => {
    localStorage.setItem(KEY, "name:asc");
    const { result } = renderHook(() => useSortDefault(KEY, FIELDS));
    act(() => {
      result.current[1]([]);
    });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current[0]).toBeNull();
  });
});
