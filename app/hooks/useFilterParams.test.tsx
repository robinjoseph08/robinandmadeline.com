import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { useFilterParams } from "./useFilterParams";

interface Query {
  search?: string;
  is_placeholder?: boolean;
}

// Stable, module-level key arrays, as the hook's contract requires.
const KEYS = ["search", "is_placeholder"] as const;
const BOOL_KEYS = ["is_placeholder"] as const;

type SetFilter = ReturnType<typeof useFilterParams<Query>>[1];

// Captures the FIRST render's setFilter so tests can call it after later
// renders, simulating a handler that holds a stale closure (e.g. a filter
// sheet control rendered before a debounced search commit).
let firstRenderSetFilter: SetFilter | undefined;

function Harness() {
  const [, setFilter] = useFilterParams<Query>(KEYS, BOOL_KEYS);
  const location = useLocation();
  firstRenderSetFilter ??= setFilter;
  return <div data-testid="location-search">{location.search}</div>;
}

beforeEach(() => {
  firstRenderSetFilter = undefined;
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
