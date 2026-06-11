/**
 * Guest API helper layered on the bare `apiRequest` (api.ts), the guest-side
 * sibling of admin-api.ts.
 *
 * A guest authenticates once with their party's RSVP code; the returned JWT
 * (long-lived, carrying the party id) is persisted here so returning visitors
 * skip code entry. Every guest endpoint reads the persisted token through
 * `guestRequest`, so the token handling lives in exactly one place. On a 401
 * the RSVP pages clear the token and send the visitor back to code entry.
 */

import { apiRequest } from "@/libraries/api";
import type { GuestLoginPayload, LoginResponse } from "@/types/generated/auth";

/**
 * localStorage key holding the guest JWT. Distinct from the admin token key so
 * the couple can be logged into both sides of the site at once.
 */
export const GUEST_TOKEN_STORAGE_KEY = "guest_token";

// Re-exported so the RSVP pages have one import for both the request helpers
// and the error type they catch.
export { ApiError } from "@/libraries/api";

/** Reads the persisted guest token, tolerating storage being unavailable. */
export function readGuestToken(): string | null {
  try {
    return localStorage.getItem(GUEST_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Persists the guest token, tolerating storage being unavailable. */
export function storeGuestToken(token: string): void {
  try {
    localStorage.setItem(GUEST_TOKEN_STORAGE_KEY, token);
  } catch {
    // Ignore storage failures (e.g. private mode); the session just won't
    // survive a reload.
  }
}

/** Clears the persisted guest token (an invalid/expired token, or a logout). */
export function clearGuestToken(): void {
  try {
    localStorage.removeItem(GUEST_TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures; there is nothing useful to do about them.
  }
}

/**
 * Exchanges an RSVP code for a guest JWT and persists it. Throws the same
 * `ApiError` as `apiRequest` (401 for an unknown code, 429 when the login rate
 * limiter throttles the caller's IP).
 */
export async function guestLogin(code: string): Promise<void> {
  const payload: GuestLoginPayload = { code };
  const { token } = await apiRequest<LoginResponse>("/auth/guest/login", {
    method: "POST",
    body: payload,
  });
  storeGuestToken(token);
}

interface GuestRequestOptions {
  method?: string;
  body?: unknown;
}

/**
 * Performs a guest API request with the persisted guest Bearer token attached,
 * returning the parsed JSON body. Throws the same `ApiError` as `apiRequest`.
 */
export function guestRequest<T>(
  path: string,
  options: GuestRequestOptions = {},
): Promise<T> {
  return apiRequest<T>(path, { ...options, token: readGuestToken() });
}
