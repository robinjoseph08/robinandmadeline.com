import { describe, expect, it } from "vitest";

import { newRequestId } from "@/libraries/request-id";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newRequestId", () => {
  it("returns a fresh v4 UUID each call", () => {
    const a = newRequestId();
    expect(a).toMatch(UUID_V4);
    expect(newRequestId()).not.toBe(a);
  });

  it("falls back to getRandomValues without randomUUID (plain-HTTP origins)", () => {
    // Shadow the prototype method on the instance, then remove the shadow.
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    try {
      const a = newRequestId();
      expect(a).toMatch(UUID_V4);
      expect(newRequestId()).not.toBe(a);
    } finally {
      delete (crypto as { randomUUID?: unknown }).randomUUID;
    }
    expect(typeof crypto.randomUUID).toBe("function");
  });
});
