import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./auth";

// Issue #7's critical E2E flow: a guest enters their party's RSVP code, fills
// in the form (statuses for every guest, a placeholder's real name, dietary
// restrictions), submits, sees the confirmation summary, then returns (the
// stored token skips code entry) and modifies their response.
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
 * Seeds the party (primary guest + placeholder) and a private event the party
 * is invited to, returning the party's RSVP code.
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
    is_public: false,
  });
  await adminPost(request, token, `/api/admin/events/${event.id}/invite`, {
    party_ids: [partyId],
  });

  return rsvpCode;
}

/** The form section (card) for one guest, located by its accessible name. */
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
  await expect(page.getByText(`Responding for ${partyName}`)).toBeVisible();
  const aliceCard = guestSection(page, alice);
  const placeholderCard = guestSection(page, placeholder);
  await expect(aliceCard.getByText(eventName)).toBeVisible();
  await expect(placeholderCard.getByText(eventName)).toBeVisible();

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

  // --- Confirmation summarizes who's attending what -------------------------
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();
  const confirmationCard = page.getByRole("region", { name: eventName });
  await expect(confirmationCard.getByText(alice)).toBeVisible();
  await expect(confirmationCard.getByText(danaName)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "View the schedule" }),
  ).toBeVisible();

  // --- Returning visitor: /rsvp skips code entry straight to the form -------
  await page.goto("/rsvp", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(`Responding for ${partyName}`)).toBeVisible();

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
  const updatedCard = page.getByRole("region", { name: eventName });
  // Alice moved from attending to not attending; Dana still attends.
  await expect(updatedCard.getByText("Not attending:")).toBeVisible();
  await expect(updatedCard.getByText(alice)).toBeVisible();
  await expect(updatedCard.getByText(danaName)).toBeVisible();
});
