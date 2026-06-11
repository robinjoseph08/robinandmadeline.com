import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./auth";

// Issue #7's critical E2E flow: a guest enters their party's RSVP code, fills
// in the form (statuses for every guest, a placeholder's real name, dietary
// restrictions), submits, and sees the per-guest confirmation summary. A
// return visit for a party that has already responded lands straight on the
// confirmation page (the stored token skips code entry), and the form stays
// reachable through "Edit your RSVP" until the deadline.
//
// Fixtures are seeded through the real admin API (no test-only endpoints): a
// party with a primary guest and a placeholder, plus a private event the party
// is invited to (private, so the fixture never touches other runs' data in the
// shared e2e database). Every entity carries a per-run unique suffix and all
// assertions are scoped to those names.

const stamp = Date.now().toString(36);
const partyName = `E2E RSVP Party ${stamp}`;
const alice = `Alice R ${stamp}`;
const placeholder = `Guest of Alice ${stamp}`;
const danaName = `Dana Lee ${stamp}`;
const eventName = `E2E Ceremony ${stamp}`;

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
 * Seeds the party (primary guest + placeholder) and a private timed event the
 * party is invited to, returning the party's RSVP code.
 */
async function seedFixtures(request: APIRequestContext): Promise<string> {
  const token = await adminToken(request);

  const party = await adminPost(request, token, "/api/admin/parties", {
    name: partyName,
    side: "robin",
    relation: "friend",
    guest: { full_name: alice },
  });
  const partyId = party.id as string;
  const rsvpCode = party.rsvp_code as string;
  expect(rsvpCode).toBeTruthy();

  await adminPost(request, token, `/api/admin/parties/${partyId}/guests`, {
    full_name: placeholder,
    is_placeholder: true,
  });

  const event = await adminPost(request, token, "/api/admin/events", {
    name: eventName,
    date: "2026-10-17",
    start_time: "17:00",
    end_time: "22:00",
    is_public: false,
  });
  await adminPost(request, token, `/api/admin/events/${event.id}/invite`, {
    party_ids: [partyId],
  });

  return rsvpCode;
}

/** The section (card) for one guest, located by its accessible name. */
function guestSection(page: Page, name: string) {
  return page.getByRole("region", { name });
}

test("guest RSVPs end to end: code entry, form, confirmation, return visit", async ({
  page,
}) => {
  const rsvpCode = await seedFixtures(page.request);

  // --- Code entry -----------------------------------------------------------
  await page.goto("/rsvp", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Party code").fill(rsvpCode);
  await page.getByRole("button", { name: "Continue" }).click();

  // --- The form shows every guest x their invited events --------------------
  // The header never exposes the party's internal admin label.
  await expect(
    page.getByText("Please respond for each member of your party."),
  ).toBeVisible();
  await expect(page.getByText(partyName)).not.toBeVisible();
  const aliceCard = guestSection(page, alice);
  const placeholderCard = guestSection(page, placeholder);
  await expect(aliceCard.getByText(eventName)).toBeVisible();
  await expect(placeholderCard.getByText(eventName)).toBeVisible();

  // The event row shows its date and 12-hour time range.
  await expect(
    aliceCard.getByText("Saturday, October 17, 2026 · 5:00 PM to 10:00 PM"),
  ).toBeVisible();

  // Alice attends; the placeholder gets a real name, attends too, and notes a
  // dietary restriction.
  await aliceCard
    .getByRole("button", { name: `${eventName}: attending` })
    .click();
  await placeholderCard.getByLabel("Name", { exact: true }).fill(danaName);
  await placeholderCard
    .getByRole("button", { name: `${eventName}: attending` })
    .click();
  await placeholderCard
    .getByLabel("Dietary restrictions")
    .fill("no nuts please");

  await page.getByRole("button", { name: "Submit RSVP" }).click();

  // --- Confirmation summarizes each guest's responses ------------------------
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();
  const aliceSummary = guestSection(page, alice);
  await expect(aliceSummary.getByText(eventName)).toBeVisible();
  await expect(
    aliceSummary.getByText("Attending", { exact: true }),
  ).toBeVisible();
  const danaSummary = guestSection(page, danaName);
  await expect(
    danaSummary.getByText("Attending", { exact: true }),
  ).toBeVisible();
  await expect(danaSummary.getByText("no nuts please")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View the schedule" }),
  ).toBeVisible();

  // --- Returning visitor: a responded party lands on the confirmation -------
  await page.goto("/rsvp", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();

  // --- The form stays reachable through "Edit your RSVP" --------------------
  await page.getByRole("link", { name: "Edit your RSVP" }).click();

  // The placeholder now shows its filled-in real name, and the earlier
  // answers are preselected.
  const danaCard = guestSection(page, danaName);
  await expect(
    danaCard.getByRole("button", { name: `${eventName}: attending` }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(danaCard.getByLabel("Dietary restrictions")).toHaveValue(
    "no nuts please",
  );

  // --- Modify before the deadline: Alice can no longer make it --------------
  const aliceReturnCard = guestSection(page, alice);
  await aliceReturnCard
    .getByRole("button", { name: `${eventName}: not attending` })
    .click();
  await page.getByRole("button", { name: "Submit RSVP" }).click();

  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();
  // Alice moved from attending to not attending; Dana still attends.
  await expect(
    guestSection(page, alice).getByText("Not attending", { exact: true }),
  ).toBeVisible();
  await expect(
    guestSection(page, danaName).getByText("Attending", { exact: true }),
  ).toBeVisible();
});
