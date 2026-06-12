import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

import { ADMIN_PASSWORD, ADMIN_USERNAME, loginAsAdmin } from "./auth";
import { runStamp } from "./stamp";

// Issue #10's critical E2E flow: the admin manages the photo groups (the
// photographer's shot list, one global shooting order for the session between
// the ceremony and the reception) on the Photo Groups page, and the guest's
// schedule gains a photos section naming which of their party's guests are in
// which groups. The admin creates two groups, assigns the guest to one,
// reorders, and the schedule section reflects the final order.
//
// Fixtures are seeded through the real admin API (no test-only endpoints);
// the photo group management itself is driven through the UI, since that is
// the surface under test. All entities carry a per-run unique suffix and
// every assertion is scoped to those names. The shooting order is GLOBAL, so
// groups left by earlier runs in the shared e2e database shift this run's raw
// positions; the assertions therefore read each group's rendered "Group X of
// N" label and check relative order and admin/guest agreement, never absolute
// numbers.

const stamp = runStamp();
const partyName = `E2E Photo Party ${stamp}`;
const guestName = `Casey C ${stamp}`;
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

/**
 * Seeds a party with one guest through the real admin API and returns the
 * party's RSVP code for the guest login. Photo groups need no event, so the
 * party is the only fixture.
 */
async function seedFixtures(request: APIRequestContext): Promise<string> {
  const token = await adminToken(request);

  const res = await request.post("/api/admin/parties", {
    data: {
      name: partyName,
      side: "robin",
      relation: "friend",
      guest: { full_name: guestName },
    },
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok()) {
    throw new Error(
      `seeding party failed: ${res.status()} ${await res.text()}`,
    );
  }
  const party = (await res.json()) as Record<string, unknown>;
  const rsvpCode = party.rsvp_code as string;
  expect(rsvpCode).toBeTruthy();
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

/**
 * The admin list row for one group, located by its visible name. Scoped to
 * the main content area because sonner's success toasts ("Added ...") are
 * also list items and carry the group's name.
 */
function groupRow(page: Page, name: string): Locator {
  return page.getByRole("main").getByRole("listitem").filter({ hasText: name });
}

/**
 * Reads a group row's rendered "Group X of N" label. Positions are global
 * across runs in the shared database, so tests compare these instead of
 * asserting absolute numbers.
 */
async function rowPosition(
  row: Locator,
): Promise<{ position: number; total: number }> {
  const label = await row.getByText(/^Group \d+ of \d+$/).textContent();
  const match = /^Group (\d+) of (\d+)$/.exec(label ?? "");
  if (!match) {
    throw new Error(`unexpected position label: ${label ?? "(missing)"}`);
  }
  return { position: Number(match[1]), total: Number(match[2]) };
}

test("admin builds the shot list and the guest's schedule names their guests per group", async ({
  page,
}) => {
  const rsvpCode = await seedFixtures(page.request);

  // --- Admin: create two groups, appended at the end of the global order ----
  await loginAsAdmin(page);
  await page.goto("/admin/photo-groups", { waitUntil: "domcontentloaded" });

  const nameInput = page.getByLabel("New photo group name");
  await nameInput.fill(familyGroupName);
  await page.getByRole("button", { name: "Add group" }).click();
  await expect(groupRow(page, familyGroupName)).toBeVisible();

  await nameInput.fill(friendsGroupName);
  await page.getByRole("button", { name: "Add group" }).click();
  await expect(groupRow(page, friendsGroupName)).toBeVisible();

  // Creates append, so the friends group sits right after the family group.
  const familyBefore = await rowPosition(groupRow(page, familyGroupName));
  const friendsBefore = await rowPosition(groupRow(page, friendsGroupName));
  expect(friendsBefore.position).toBe(familyBefore.position + 1);

  // --- Admin: assign the guest to the friends group --------------------------
  await page
    .getByRole("combobox", { name: `Add guest to ${friendsGroupName}` })
    .click();
  // The picker searches the full guest list; type to isolate this run's guest.
  await page.getByPlaceholder("Search guests...").fill(guestName);
  await page.getByRole("option", { name: new RegExp(guestName) }).click();
  await expect(
    groupRow(page, friendsGroupName).getByText(`${guestName} (${partyName})`),
  ).toBeVisible();

  // --- Admin: move the guest's group one slot up in the shooting order -------
  await page
    .getByRole("button", { name: `Move ${friendsGroupName} up` })
    .click();
  await expect(async () => {
    const friendsAfter = await rowPosition(groupRow(page, friendsGroupName));
    expect(friendsAfter.position).toBe(friendsBefore.position - 1);
  }).toPass();
  const familyAfter = await rowPosition(groupRow(page, familyGroupName));
  expect(familyAfter.position).toBe(familyBefore.position + 1);
  const friendsAfter = await rowPosition(groupRow(page, friendsGroupName));

  // --- Anonymous: the schedule has no photos section -------------------------
  await page.goto("/schedule", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Photos" })).not.toBeVisible();

  // --- Guest: the photos section names the party's guest with the position ---
  await loginAsGuest(page, rsvpCode);
  await page.goto("/schedule", { waitUntil: "domcontentloaded" });

  const photos = page.getByRole("region", { name: "Photos" });
  await expect(photos).toBeVisible();
  await expect(
    photos.getByText(/group photos after the ceremony, before the reception/i),
  ).toBeVisible();
  // The line carries the same global position the admin page showed, and the
  // guest's first name. The family group holds none of this party's guests,
  // so it never appears.
  await expect(
    photos.getByText(
      `${friendsGroupName} (group ${friendsAfter.position} of ${friendsAfter.total}): Casey`,
    ),
  ).toBeVisible();
  await expect(photos.getByText(familyGroupName)).not.toBeVisible();
});
