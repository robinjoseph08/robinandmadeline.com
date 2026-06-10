/**
 * Minimal fetch wrapper for the JSON API.
 *
 * The backend mounts every route under /api, and in development Vite proxies
 * /api to the Go server, so relative URLs work in both dev and production. This
 * helper attaches an optional bearer token, sends/parses JSON, and surfaces a
 * typed error for non-2xx responses. It is deliberately small: there is no
 * client state library yet, just this and the auth context.
 */

import type { ErrorCode, ErrorEnvelope } from "@/types/generated/errcodes";

const API_PREFIX = "/api";

export interface ApiErrorShape {
  status: number;
  message: string;
  code?: ErrorCode;
}

/** Error thrown for any non-2xx API response. */
export class ApiError extends Error implements ApiErrorShape {
  status: number;
  code?: ErrorCode;

  constructor(status: number, message: string, code?: ErrorCode) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
}

/**
 * Performs a JSON request against the API and returns the parsed body.
 *
 * Throws an ApiError when the response status is not 2xx, carrying the status
 * code so callers can branch on, for example, 401.
 */
export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { method = "GET", body, token } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_PREFIX}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const { message, code } = await errorDetail(response);
    throw new ApiError(response.status, message, code);
  }

  // 204 No Content (and other empty bodies) parse to undefined.
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Extracts the message (and code) from the API's nested error envelope:
 * `{ "error": { "code", "message", "status_code" } }`. Falls back to a generic
 * message when the body is absent or not the expected shape.
 */
async function errorDetail(
  response: Response,
): Promise<{ message: string; code?: ErrorCode }> {
  try {
    // Cast to the generated envelope type (ADR 0008); Partial keeps the parse
    // defensive against non-envelope bodies, and the message check below guards
    // shapes that are JSON but not ours.
    const data = (await response.clone().json()) as Partial<ErrorEnvelope>;
    const detail = data?.error;
    if (detail && typeof detail.message === "string") {
      return { message: detail.message, code: detail.code };
    }
  } catch {
    // Fall through to a generic message when the body is not JSON.
  }
  return { message: `Request failed with status ${response.status}` };
}
