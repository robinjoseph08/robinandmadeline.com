import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminRequest,
  onAdminUnauthorized,
  TOKEN_STORAGE_KEY,
} from "./admin-api";
import * as api from "./api";
import { ApiError } from "./api";

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

// A stale admin token surfaces as a 401 on every request; the helper clears it
// and notifies subscribers so the auth provider can redirect to login rather
// than leaving the admin stuck on an "Invalid or expired token." page.
describe("adminRequest on a 401", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("clears the stored token and notifies listeners", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "stale.jwt.token");
    vi.spyOn(api, "apiRequest").mockRejectedValue(
      new ApiError(401, "Invalid or expired token."),
    );
    const listener = vi.fn();
    const unsubscribe = onAdminUnauthorized(listener);

    await expect(adminRequest("/admin/parties")).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("leaves the token and listeners alone for non-401 errors", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "good.jwt.token");
    vi.spyOn(api, "apiRequest").mockRejectedValue(
      new ApiError(500, "Something broke."),
    );
    const listener = vi.fn();
    const unsubscribe = onAdminUnauthorized(listener);

    await expect(adminRequest("/admin/parties")).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("good.jwt.token");
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("does not clear or notify a 401 when no token was attached", async () => {
    // No token in storage: the request goes out anonymously, so a 401 is not a
    // stale-token signal and must not tear down a (non-existent) session.
    vi.spyOn(api, "apiRequest").mockRejectedValue(
      new ApiError(401, "Invalid or expired token."),
    );
    const listener = vi.fn();
    const unsubscribe = onAdminUnauthorized(listener);

    await expect(adminRequest("/admin/parties")).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("does not clear a token that changed since the request started", async () => {
    // Models a slow request carrying an old token that 401s only after the
    // admin has re-logged-in: the newer token must survive and no redirect
    // should fire.
    localStorage.setItem(TOKEN_STORAGE_KEY, "old.jwt.token");
    vi.spyOn(api, "apiRequest").mockImplementation(async () => {
      localStorage.setItem(TOKEN_STORAGE_KEY, "new.jwt.token");
      throw new ApiError(401, "Invalid or expired token.");
    });
    const listener = vi.fn();
    const unsubscribe = onAdminUnauthorized(listener);

    await expect(adminRequest("/admin/parties")).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("new.jwt.token");
    expect(listener).not.toHaveBeenCalled();

    unsubscribe();
  });

  it("stops notifying after unsubscribe", async () => {
    localStorage.setItem(TOKEN_STORAGE_KEY, "stale.jwt.token");
    vi.spyOn(api, "apiRequest").mockRejectedValue(
      new ApiError(401, "Invalid or expired token."),
    );
    const listener = vi.fn();
    onAdminUnauthorized(listener)();

    await expect(adminRequest("/admin/parties")).rejects.toBeInstanceOf(
      ApiError,
    );

    expect(listener).not.toHaveBeenCalled();
  });
});
