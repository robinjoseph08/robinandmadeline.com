import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminRequest, TOKEN_STORAGE_KEY } from "./admin-api";
import * as api from "./api";

// adminRequest is the seam every admin query hook goes through, so its two jobs
// are worth pinning: attach the stored token, and serialize the query object.
describe("adminRequest", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(api, "apiRequest").mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("forwards the persisted admin token to apiRequest", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "a.jwt.token");

    await adminRequest("/admin/parties");

    expect(api.apiRequest).toHaveBeenCalledWith(
      "/admin/parties",
      expect.objectContaining({ token: "a.jwt.token", method: "GET" }),
    );
  });

  it("passes a null token when none is stored", async () => {
    await adminRequest("/admin/parties");

    expect(api.apiRequest).toHaveBeenCalledWith(
      "/admin/parties",
      expect.objectContaining({ token: null }),
    );
  });

  it("serializes the query object and skips null/undefined filters", async () => {
    await adminRequest("/admin/parties", {
      query: {
        side: "robin",
        relation: undefined,
        info_collection_requested: true,
      },
    });

    const calledPath = vi.mocked(api.apiRequest).mock.calls[0][0];
    expect(calledPath).toContain("side=robin");
    expect(calledPath).toContain("info_collection_requested=true");
    expect(calledPath).not.toContain("relation");
  });

  it("forwards the method and body for writes", async () => {
    await adminRequest("/admin/parties", {
      method: "POST",
      body: { name: "Test" },
    });

    expect(api.apiRequest).toHaveBeenCalledWith(
      "/admin/parties",
      expect.objectContaining({ method: "POST", body: { name: "Test" } }),
    );
  });
});
