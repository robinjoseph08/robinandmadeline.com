import { describe, expect, it } from "vitest";

import type { RSVPGuest } from "@/types/generated/rsvps";

import { isNamedPlaceholder, isPlaceholder } from "./placeholders";

function makeGuest(overrides: Partial<RSVPGuest>): RSVPGuest {
  return {
    id: "g1",
    full_name: "Alice Smith",
    placeholder_text: undefined,
    dietary_restrictions: undefined,
    ...overrides,
  };
}

describe("isPlaceholder", () => {
  it("is true exactly when the guest carries a descriptor", () => {
    expect(isPlaceholder(makeGuest({}))).toBe(false);
    expect(
      isPlaceholder(
        makeGuest({
          full_name: "Guest of Alice",
          placeholder_text: "Guest of Alice",
        }),
      ),
    ).toBe(true);
  });
});

describe("isNamedPlaceholder", () => {
  it("is false for a regular guest", () => {
    expect(isNamedPlaceholder(makeGuest({}))).toBe(false);
  });

  it("is false for an unnamed slot (full_name still equals the descriptor)", () => {
    expect(
      isNamedPlaceholder(
        makeGuest({
          full_name: "Guest of Alice",
          placeholder_text: "Guest of Alice",
        }),
      ),
    ).toBe(false);
  });

  it("is true once the party has filled in a real name", () => {
    expect(
      isNamedPlaceholder(
        makeGuest({
          full_name: "Dana Lee",
          placeholder_text: "Guest of Alice",
        }),
      ),
    ).toBe(true);
  });
});
