import { describe, expect, it } from "vitest";

import {
  checkSquares,
  checkStatesFromGrid,
  restoreCheckStates,
} from "./checking";
import { gridFromEntries } from "./puzzle";
import { proposal } from "./puzzle-data-proposal";

const EMPTY_ENTRIES = proposal.solution.replace(/[A-Z]/g, "?");

function entriesWith(updates: Record<number, string>): string {
  const entries = EMPTY_ENTRIES.split("");
  for (const [index, value] of Object.entries(updates)) {
    entries[Number(index)] = value;
  }
  return entries.join("");
}

describe("crossword checking", () => {
  it("marks only filled requested squares and reports how many it evaluated", () => {
    const grid = gridFromEntries(
      proposal,
      entriesWith({ 1: proposal.solution[1], 2: "X" }),
    );

    const result = checkSquares(grid, proposal.solution, [
      grid.squares[1],
      grid.squares[2],
      grid.squares[3],
    ]);

    expect(result.evaluated).toBe(2);
    expect(result.grid.squares[1].checkState).toBe("correct");
    expect(result.grid.squares[2].checkState).toBe("incorrect");
    expect(result.grid.squares[3].checkState).toBeUndefined();
  });

  it("serializes and restores valid check states", () => {
    const grid = gridFromEntries(
      proposal,
      entriesWith({ 1: proposal.solution[1], 2: "X" }),
    );
    const checked = checkSquares(grid, proposal.solution, grid.squares).grid;
    const saved = checkStatesFromGrid(checked);

    const restored = restoreCheckStates(
      gridFromEntries(
        proposal,
        entriesWith({ 1: proposal.solution[1], 2: "X" }),
      ),
      proposal.solution,
      saved,
    );

    expect(restored.squares[1].checkState).toBe("correct");
    expect(restored.squares[2].checkState).toBe("incorrect");
    expect(checkStatesFromGrid(restored)).toBe(saved);
  });

  it("rejects malformed markers and block-layout mismatches", () => {
    const grid = gridFromEntries(proposal, EMPTY_ENTRIES);

    expect(restoreCheckStates(grid, proposal.solution, "short")).toBe(grid);
    expect(
      restoreCheckStates(
        grid,
        proposal.solution,
        checkStatesFromGrid(grid).replace(".", "?"),
      ),
    ).toBe(grid);
  });

  it("drops stale markers that disagree with the saved entries", () => {
    const grid = gridFromEntries(
      proposal,
      entriesWith({ 1: proposal.solution[1], 2: "X" }),
    );
    const stale = checkStatesFromGrid(grid).split("");
    stale[1] = "i";
    stale[2] = "c";

    const restored = restoreCheckStates(
      grid,
      proposal.solution,
      stale.join(""),
    );

    expect(restored).toBe(grid);
    expect(restored.squares[1].checkState).toBeUndefined();
    expect(restored.squares[2].checkState).toBeUndefined();
  });
});
