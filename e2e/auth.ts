import type { Page } from "@playwright/test";

// Config-based admin credentials. The e2e API pins these (see playwright.config),
// so they are deterministic regardless of the surrounding environment.
export const ADMIN_USERNAME = "admin";
export const ADMIN_PASSWORD = "changeme";

// The localStorage key the SPA reads its admin JWT from (TOKEN_STORAGE_KEY in
// app/libraries/admin-api.ts). Kept in sync by hand since the e2e harness cannot
// import app code.
const TOKEN_STORAGE_KEY = "admin_token";

/**
 * Authenticates the page as the admin. It logs in through the API (proxied by
 * the Vite dev server at /api) to mint a JWT, then seeds it into localStorage via
 * addInitScript so the token is present before the SPA boots on the next
 * navigation. This avoids driving the login form in every spec while still
 * exercising the real login endpoint.
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  const res = await page.request.post("/api/auth/admin/login", {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`admin login failed: ${res.status()} ${await res.text()}`);
  }
  const { token } = (await res.json()) as { token: string };
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [TOKEN_STORAGE_KEY, token] as const,
  );
}
