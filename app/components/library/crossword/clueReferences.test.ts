import { describe, expect, it } from "vitest";

import { parseClueReferences } from "./clueReferences";

describe("parseClueReferences", () => {
  it("finds across and down references without treating plain numbers as clues", () => {
    expect(
      parseClueReferences(
        "Where 23-Across lives, unlike room 12 or the answer to 7-Down",
      ),
    ).toEqual([
      { number: "23", direction: "across" },
      { number: "7", direction: "down" },
    ]);
  });

  it("accepts case and dash variants and removes duplicates", () => {
    expect(
      parseClueReferences("See 1-across, 2–DOWN, and again 1—Across"),
    ).toEqual([
      { number: "1", direction: "across" },
      { number: "2", direction: "down" },
    ]);
  });
});
