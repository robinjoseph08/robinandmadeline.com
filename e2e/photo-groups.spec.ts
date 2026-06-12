import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { ADMIN_PASSWORD, ADMIN_USERNAME, loginAsAdmin } from "./auth";

// Issue #10's critical E2E flow: the admin manages an event's photo groups
// (the photographer's shot list) on the Photo Groups page, and the guest's
// schedule shows the groups their party is in, with positions in the shooting
// order. The admin creates two groups, reorders them, assigns the guest to
// one, and the schedule line reflects the final order.
//
// Fixtures are seeded through the real admin API (no test-only endpoints);
// the photo group management itself is driven through the UI, since that is
// the surface under test. All entities carry a per-run unique suffix and
// every assertion is scoped to those names, so this spec neither breaks nor
// is broken by data from other runs in the shared e2e database. The event is
// private with only this run's party invited, so its photo-group positions
// are fully owned by this run (a public event would share its shot list with
// other runs' groups).

const stamp = Date.now().toString(36);
const partyName = `E2E Photo Party ${stamp}`;
const guestName = `Casey C ${stamp}`;
const eventName = `E2E Portraits Session ${stamp}`;
const familyGroupName = `Family Photos ${stamp}`;
const friendsGroupName = `Friends Photos ${stamp}`;

// The localStorage key the SPA reads its guest JWT from
// (GUEST_TOKEN_STORAGE_KEY in app/libraries/guest-api.ts). Kept in sync by
// hand since the e2e harness cannot import app code.
const GUEST_TOKEN_STORAGE_KEY = "guest_token";

/** Logs in through the real admin endpoint and returns the bearer token. */
async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post("/api/auth/admin/login", {
    data: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
  });
  if (!res.ok()) {
    throw new Error(`admin login failed: ${res.status()} ${await res.text()}`);
  }
  const { token } = (await res.json()) as { token: string };
  return token;
}

/** Performs an authenticated admin API POST, failing loudly on a non-2xx. */
async function adminPost(
  request: APIRequestContext,
  token: string,
  path: string,
  data: unknown,
): Promise<Record<string, unknown>> {
  const res = await request.post(path, {
    data,
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) {
    throw new Error(`${path} failed: ${res.status()} ${await res.text()}`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Seeds a party with one guest and a private event the party is invited to.
 * Returns the party's RSVP code for the guest login.
 */
async function seedFixtures(request: APIRequestContext): Promise<string> {
  const token = await adminToken(request);

  const party = await adminPost(request, token, "/api/admin/parties", {
    name: partyName,
    side: "robin",
    relation: "friend",
    guest: { full_name: guestName },
  });
  const rsvpCode = party.rsvp_code as string;
  expect(rsvpCode).toBeTruthy();

  const event = await adminPost(request, token, "/api/admin/events", {
    name: eventName,
    date: "2026-10-17",
    start_time: "15:00",
    is_public: false,
  });
  await adminPost(request, token, `/api/admin/events/${event.id}/invite`, {
    party_ids: [party.id as string],
  });

  return rsvpCode;
}

/**
 * Authenticates the page as the seeded party's guest: exchanges the RSVP code
 * for a guest JWT through the real login endpoint, then seeds it into
 * localStorage so the token is present before the SPA boots on the next
 * navigation (mirroring loginAsAdmin in auth.ts).
 */
async function loginAsGuest(page: Page, code: string): Promise<void> {
  const res = await page.request.post("/api/auth/guest/login", {
    data: { code },
  });
  if (!res.ok()) {
    throw new Error(`guest login failed: ${res.status()} ${await res.text()}`);
  }
  const { token } = (await res.json()) as { token: string };
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value),
    [GUEST_TOKEN_STORAGE_KEY, token] as const,
  );
}

test("admin builds an event's photo groups and the guest sees their groups on the schedule", async ({
  page,
}) => {
  const rsvpCode = await seedFixtures(page.request);

  // --- Admin: create two groups under the event ------------------------------
  await loginAsAdmin(page);
  await page.goto("/admin/photo-groups", { waitUntil: "domcontentloaded" });

  const section = page.getByRole("region", { name: eventName });
  await expect(section).toBeVisible();

  const nameInput = section.getByLabel(`New photo group name for ${eventName}`);
  await nameInput.fill(familyGroupName);
  await section
    .getByRole("button", { name: `Add group to ${eventName}` })
    .click();
  await expect(section.getByText(familyGroupName)).toBeVisible();

  await nameInput.fill(friendsGroupName);
  await section
    .getByRole("button", { name: `Add group to ${eventName}` })
    .click();
  await expect(section.getByText(friendsGroupName)).toBeVisible();

  // --- Admin: assign the guest to the second group ---------------------------
  await section
    .getByRole("combobox", { name: `Add guest to ${friendsGroupName}` })
    .click();
  // The picker searches the full guest list; type to isolate this run's guest.
  await page.getByPlaceholder("Search guests...").fill(guestName);
  await page.getByRole("option", { name: new RegExp(guestName) }).click();
  await expect(section.getByText(`${guestName} (${partyName})`)).toBeVisible();

  // --- Admin: move the guest's group to the front of the shooting order ------
  await section
    .getByRole("button", { name: `Move ${friendsGroupName} up` })
    .click();
  // The order swap lands: the friends group is now group 1.
  const friendsRow = section
    .getByRole("listitem")
    .filter({ hasText: friendsGroupName });
  await expect(friendsRow.getByText("Group 1 of 2")).toBeVisible();

  // --- Guest: the schedule shows the group with its position -----------------
  await loginAsGuest(page, rsvpCode);
  await page.goto("/schedule", { waitUntil: "domcontentloaded" });

  const eventCard = page.getByRole("article", { name: eventName });
  await expect(eventCard).toBeVisible();
  await expect(
    eventCard.getByText(
      `Stay for photos! You're in: ${friendsGroupName}. Group 1 of 2.`,
    ),
  ).toBeVisible();
});
