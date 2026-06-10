/**
 * Admin API helper layered on the bare `apiRequest` (api.ts).
 *
 * Every admin endpoint is behind the admin JWT, so this helper reads the
 * persisted admin token and threads it into `apiRequest` as a Bearer token. It
 * also serializes an optional query object so list filters become a query
 * string. The react-query hooks call this rather than `apiRequest` directly, so
 * the token handling lives in exactly one place. On a 401 the existing
 * RequireAdmin guard handles the redirect; this helper just lets the `ApiError`
 * propagate so callers can surface `ApiError.message` from the error envelope.
 */

import QueryString from "qs";

import { apiRequest } from "@/libraries/api";

/**
 * localStorage key holding the admin JWT. Owned here (the helper that reads it
 * for requests) and reused by the auth provider that writes it, so there is a
 * single source of truth for the key.
 */
export const TOKEN_STORAGE_KEY = "admin_token";

// Re-exported so the query hooks have one import for both the request helper and
// the error type they catch.
export { ApiError } from "@/libraries/api";

/** Reads the persisted admin token, tolerating storage being unavailable. */
function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
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
 */
export function adminRequest<T>(
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

  return apiRequest<T>(fullPath, { method, body, token: readToken() });
}
