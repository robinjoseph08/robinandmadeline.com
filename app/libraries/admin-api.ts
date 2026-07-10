/**
 * Admin API helper layered on the bare `apiRequest` (api.ts).
 *
 * Every admin endpoint is behind the admin JWT, so this helper reads the
 * persisted admin token and threads it into `apiRequest` as a Bearer token. It
 * also serializes an optional query object so list filters become a query
 * string. The react-query hooks call this rather than `apiRequest` directly, so
 * the token handling lives in exactly one place. When a request that carried a
 * token is rejected with a 401 (the attached token is expired or tampered) it
 * drops the stored token and notifies the auth provider so the route guard
 * redirects to the login page, rather than leaving the admin stuck on a page
 * that only renders "Invalid or expired token." Any other error is left to
 * propagate so callers can surface `ApiError.message` from the error envelope.
 */

import QueryString from "qs";

import { ApiError, apiRequest } from "@/libraries/api";

/**
 * localStorage key holding the admin JWT. Owned here (the helper that reads it
 * for requests) and reused by the auth provider that writes it, so there is a
 * single source of truth for the key.
 */
export const TOKEN_STORAGE_KEY = "admin_token";

// Re-exported so the query hooks have one import for both the request helper and
// the error type they catch.
export { ApiError };

/**
 * Listeners notified when a request is rejected for a stale admin token, so the
 * auth provider can clear its in-memory state and let the guard redirect. Kept
 * here because this helper is where the 401 is observed and the token cleared;
 * the provider only mirrors that into React state.
 */
type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/**
 * Subscribes to admin 401s. Returns an unsubscribe function so the auth
 * provider can register in an effect and clean up on unmount.
 */
export function onAdminUnauthorized(
  listener: UnauthorizedListener,
): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

/** Reads the persisted admin token, tolerating storage being unavailable. */
function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Drops the persisted admin token, tolerating storage being unavailable. */
function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // Ignore storage failures; notifying listeners clears the in-memory token,
    // which is what drives the redirect.
  }
}

interface AdminRequestOptions {
  method?: string;
  body?: unknown;
  /**
   * Serialized onto the path as a query string (skips null/undefined values).
   * Typed as a plain object so the generated `List*Query` filter types, which
   * lack a string index signature, pass without a cast.
   */
  query?: object;
}

/**
 * Performs an admin API request: attaches the admin Bearer token, appends any
 * query object as a query string, and returns the parsed JSON body (or
 * undefined for 204). Throws the same `ApiError` as `apiRequest`.
 *
 * A 401 on a request whose attached token is still the stored one means that
 * token went stale, so it is cleared and listeners are notified (see
 * `onAdminUnauthorized`) before the error is re-thrown; the auth provider then
 * redirects to the login page.
 */
export async function adminRequest<T>(
  path: string,
  options: AdminRequestOptions = {},
): Promise<T> {
  const { method = "GET", body, query } = options;

  let fullPath = path;
  if (query) {
    // skipNulls drops absent filters; indices:false keeps array filters flat.
    const queryString = QueryString.stringify(query, {
      skipNulls: true,
      indices: false,
    });
    if (queryString) {
      fullPath = `${path}?${queryString}`;
    }
  }

  const token = readToken();
  try {
    return await apiRequest<T>(fullPath, { method, body, token });
  } catch (err) {
    // Only tear down the session when the token this request carried is still
    // the stored one. A 401 from a request that predates a re-login (readToken
    // has since changed) must not clear the newer token or bounce the freshly
    // authenticated admin; this also dedups concurrent 401s, since the first
    // clear makes the rest no-ops.
    if (
      token &&
      readToken() === token &&
      err instanceof ApiError &&
      err.status === 401
    ) {
      clearToken();
      unauthorizedListeners.forEach((listener) => listener());
    }
    throw err;
  }
}
