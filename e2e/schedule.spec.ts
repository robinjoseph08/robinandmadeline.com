import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./auth";

// Issue #9's critical E2E flow: the schedule page adapts to authentication.
// An anonymous visitor sees only public events plus a prompt to enter their
// party code; after logging in with the code, the same page also shows the
// private events the party is invited to (marked with a badge) while private
// events the party is NOT invited to stay hidden. Every event offers an .ics
// download and a prefilled Google Calendar link.
//
// Fixtures are seeded through the real admin API (no test-only endpoints).
// The public event is visible to every run by design; all entities carry a
// per-run unique suffix and every assertion is scoped to those names, so this
// spec neither breaks nor is broken by data from other runs in the shared e2e
// database.

const stamp = Date.now().toString(36);
const partyName = `E2E Schedule Party ${stamp}`;
const guestName = `Sam S ${stamp}`;
const publicEventName = `E2E Welcome Party ${stamp}`;
const invitedEventName = `E2E Rehearsal Dinner ${stamp}`;
const uninvitedEventName = `E2E Bridal Photos ${stamp}`;

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
 * Seeds a party with one guest, a public event, a private event the party is
 * invited to, and a private event only a second party is invited to (so its
 * invisibility proves invitations are scoped to the requesting party, not
 * merely present). Returns the first party's RSVP code.
 */
async function seedFixtures(request: APIRequestContext): Promise<string> {
  const token = await adminToken(request);

  const party = await adminPost(request, token, "/api/admin/parties", {
    name: partyName,
    side: "robin",
    relation: "friend",
    guest: { full_name: guestName },
  });
  const partyId = party.id as string;
  const rsvpCode = party.rsvp_code as string;
  expect(rsvpCode).toBeTruthy();

  const otherParty = await adminPost(request, token, "/api/admin/parties", {
    name: `${partyName} Other`,
    side: "madeline",
    relation: "friend",
    guest: { full_name: `Riley R ${stamp}` },
  });

  await adminPost(request, token, "/api/admin/events", {
    name: publicEventName,
    date: "2026-10-17",
    start_time: "19:00",
    end_time: "22:00",
    location: "The Grand Hall",
    description: "Drinks and dancing to kick off the weekend.",
    is_public: true,
  });

  const invited = await adminPost(request, token, "/api/admin/events", {
    name: invitedEventName,
    date: "2026-10-16",
    start_time: "18:00",
    is_public: false,
  });
  await adminPost(request, token, `/api/admin/events/${invited.id}/invite`, {
    party_ids: [partyId],
  });

  const uninvited = await adminPost(request, token, "/api/admin/events", {
    name: uninvitedEventName,
    date: "2026-10-17",
    start_time: "10:00",
    is_public: false,
  });
  await adminPost(request, token, `/api/admin/events/${uninvited.id}/invite`, {
    party_ids: [otherParty.id as string],
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

/** The card for one event, located by its accessible name. */
function eventCard(page: Page, name: string) {
  return page.getByRole("article", { name });
}

test("schedule shows public events to everyone and invited private events to a logged-in guest", async ({
  page,
}) => {
  const rsvpCode = await seedFixtures(page.request);

  // --- Anonymous: public events only, plus the code prompt -------------------
  await page.goto("/schedule", { waitUntil: "domcontentloaded" });

  const publicCard = eventCard(page, publicEventName);
  await expect(publicCard).toBeVisible();
  await expect(
    publicCard.getByText("Saturday, October 17, 2026 · 7:00 PM to 10:00 PM"),
  ).toBeVisible();
  await expect(publicCard.getByText("The Grand Hall")).toBeVisible();
  await expect(
    publicCard.getByText("Drinks and dancing to kick off the weekend."),
  ).toBeVisible();

  await expect(eventCard(page, invitedEventName)).not.toBeVisible();
  await expect(eventCard(page, uninvitedEventName)).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "Enter your party code" }),
  ).toBeVisible();

  // --- Add to Calendar: a Google Calendar link and an .ics download ----------
  const googleLink = publicCard.getByRole("link", { name: "Google Calendar" });
  const href = await googleLink.getAttribute("href");
  expect(href).toContain("https://calendar.google.com/calendar/render");
  expect(href).toContain("20261017T190000%2F20261017T220000");

  const downloadPromise = page.waitForEvent("download");
  await publicCard
    .getByRole("button", { name: "Add to Calendar (.ics)" })
    .click();
  const download = await downloadPromise;
  // The filename is the slugified event name (the stamp is already lowercase
  // base36).
  expect(download.suggestedFilename()).toBe(`e2e-welcome-party-${stamp}.ics`);

  // --- Authenticated: the invited private event appears, marked --------------
  await loginAsGuest(page, rsvpCode);
  await page.goto("/schedule", { waitUntil: "domcontentloaded" });

  const invitedCard = eventCard(page, invitedEventName);
  await expect(invitedCard).toBeVisible();
  await expect(invitedCard.getByText("You're invited")).toBeVisible();
  // The public event stays, unmarked; the uninvited private event stays
  // hidden; the code prompt is gone.
  const publicCardAuthed = eventCard(page, publicEventName);
  await expect(publicCardAuthed).toBeVisible();
  await expect(publicCardAuthed.getByText("You're invited")).not.toBeVisible();
  await expect(eventCard(page, uninvitedEventName)).not.toBeVisible();
  await expect(
    page.getByRole("link", { name: "Enter your party code" }),
  ).not.toBeVisible();
});
