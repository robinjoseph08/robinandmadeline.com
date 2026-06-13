import { act, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { useFilterParams } from "./useFilterParams";

interface Query {
  search?: string;
  is_placeholder?: boolean;
  tags?: string[];
}

// Stable, module-level key arrays, as the hook's contract requires.
const KEYS = ["search", "is_placeholder", "tags"] as const;
const BOOL_KEYS = ["is_placeholder"] as const;
const ARRAY_KEYS = ["tags"] as const;

type SetFilter = ReturnType<typeof useFilterParams<Query>>[1];

// Captures the FIRST render's setFilter so tests can call it after later
// renders, simulating a handler that holds a stale closure (e.g. a filter
// sheet control rendered before a debounced search commit).
let firstRenderSetFilter: SetFilter | undefined;
// The latest parsed filters, so array tests can assert the read side.
let latestFilters: Query | undefined;
// The latest setFilter, so array tests can drive writes from current state.
let latestSetFilter: SetFilter | undefined;

function Harness() {
  const [filters, setFilter] = useFilterParams<Query>(
    KEYS,
    BOOL_KEYS,
    ARRAY_KEYS,
  );
  const location = useLocation();
  firstRenderSetFilter ??= setFilter;
  // Assign the latest values from an effect, not during render: effects run
  // outside render (and flush synchronously inside act), so the array tests can
  // read them after a render or drive setFilter inside act().
  useEffect(() => {
    latestFilters = filters;
    latestSetFilter = setFilter;
  });
  return <div data-testid="location-search">{location.search}</div>;
}

beforeEach(() => {
  firstRenderSetFilter = undefined;
  latestFilters = undefined;
  latestSetFilter = undefined;
});

describe("useFilterParams stale-closure safety", () => {
  it("a write from an old render's closure preserves params committed since", () => {
    render(
      <MemoryRouter initialEntries={["/admin/guests"]}>
        <Harness />
      </MemoryRouter>,
    );
    const staleSetFilter = firstRenderSetFilter!;

    // Commit a search param (re-rendering with the new URL).
    act(() => staleSetFilter("search", "alice"));
    expect(screen.getByTestId("location-search")).toHaveTextContent(
      "search=alice",
    );

    // Now write a different filter through the FIRST render's closure, which
    // predates the search commit. react-router's functional setSearchParams
    // would hand it the captured (empty) params and erase the search; the
    // hook must base the write on the current params instead.
    act(() => staleSetFilter("is_placeholder", true));

    const search = screen.getByTestId("location-search");
    expect(search).toHaveTextContent("search=alice");
    expect(search).toHaveTextContent("is_placeholder=true");
  });

  it("two writes in the same tick compose; the second preserves the first", () => {
    render(
      <MemoryRouter initialEntries={["/admin/guests"]}>
        <Harness />
      </MemoryRouter>,
    );
    const setFilter = firstRenderSetFilter!;

    // Both writes land before React re-renders (a debounce timer firing in the
    // same task as a filter-control click, e.g. under CPU load). The second
    // write must build on the first or it silently erases it: this is the
    // guests-page race where the filter sheet's write reverted the search
    // box's debounced commit and the page stuck on the stale search.
    act(() => {
      setFilter("search", "alice");
      setFilter("is_placeholder", true);
    });

    const search = screen.getByTestId("location-search");
    expect(search).toHaveTextContent("search=alice");
    expect(search).toHaveTextContent("is_placeholder=true");
  });
});

describe("useFilterParams array (multi-value) keys", () => {
  it("reads multiple values for an array key from the URL", () => {
    render(
      <MemoryRouter initialEntries={["/admin/guests?tags=a&tags=b"]}>
        <Harness />
      </MemoryRouter>,
    );
    expect(latestFilters?.tags).toEqual(["a", "b"]);
  });

  it("round-trips multiple written values, replacing the whole set", () => {
    render(
      <MemoryRouter initialEntries={["/admin/guests"]}>
        <Harness />
      </MemoryRouter>,
    );

    act(() => latestSetFilter!("tags", ["a", "b"]));
    const search = screen.getByTestId("location-search");
    expect(search).toHaveTextContent("tags=a");
    expect(search).toHaveTextContent("tags=b");
    expect(latestFilters?.tags).toEqual(["a", "b"]);

    // Writing a new array replaces the prior values rather than appending.
    act(() => latestSetFilter!("tags", ["c"]));
    expect(latestFilters?.tags).toEqual(["c"]);
    expect(screen.getByTestId("location-search")).not.toHaveTextContent(
      "tags=a",
    );
  });

  it("clearing an array key (empty array) removes the param entirely", () => {
    render(
      <MemoryRouter initialEntries={["/admin/guests?tags=a&tags=b"]}>
        <Harness />
      </MemoryRouter>,
    );

    act(() => latestSetFilter!("tags", []));
    expect(latestFilters?.tags).toBeUndefined();
    expect(screen.getByTestId("location-search")).not.toHaveTextContent("tags");
  });

  it("array writes preserve other params committed since (stale-closure safety)", () => {
    render(
      <MemoryRouter initialEntries={["/admin/guests"]}>
        <Harness />
      </MemoryRouter>,
    );
    const staleSetFilter = firstRenderSetFilter!;

    // Commit a scalar param, then write an array through a closure that
    // predates it: the array write must build on current params (the same
    // write-through-ref path the scalar writes use), not erase the search.
    act(() => staleSetFilter("search", "alice"));
    act(() => staleSetFilter("tags", ["x", "y"]));

    const search = screen.getByTestId("location-search");
    expect(search).toHaveTextContent("search=alice");
    expect(search).toHaveTextContent("tags=x");
    expect(search).toHaveTextContent("tags=y");
  });
});
