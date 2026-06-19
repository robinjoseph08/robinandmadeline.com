import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./auth";
import { runStamp } from "./stamp";

// Issue #8's critical E2E flow: a guest opens their party's personalized
// /i/:token link, sees their party members' names pre-filled, corrects a
// best-guess name, fills in contact details and (for a physical party) the
// mailing address, removes a guest who is no longer part of the party, and
// submits. A revisit of the same link shows the saved values, with the
// removed guest gone. Placeholder guests (plus-one slots) never appear in
// this flow at all (they first surface during RSVP), and a digital party's
// page omits the address section entirely.
//
// Fixtures are seeded through the real admin API (no test-only endpoints).
// Every entity carries a per-run unique suffix and all assertions are scoped
// to those names, so the spec is robust against data left by earlier runs in
// the shared e2e database.

const stamp = runStamp();
const physicalPartyName = `E2E Info Party ${stamp}`;
const bestGuessName = `Allice R ${stamp}`;
const correctedName = `Alice R ${stamp}`;
const bobName = `Bob R ${stamp}`;
const placeholder = `Guest of Alice ${stamp}`;
const digitalPartyName = `E2E Info Digital Party ${stamp}`;
const carolName = `Carol D ${stamp}`;

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
 * Seeds a physical party with a best-guess-named primary, a second guest, and
 * a placeholder slot (which the info page must never show), returning its
 * info token.
 */
async function seedPhysicalParty(request: APIRequestContext): Promise<string> {
  const token = await adminToken(request);

  const party = await adminPost(request, token, "/api/admin/parties", {
    name: physicalPartyName,
    side: "robin",
    relation: "friend",
    invitation_type: "physical",
    guest: { full_name: bestGuessName },
  });
  const partyId = party.id as string;
  const infoToken = party.info_token as string;
  expect(infoToken).toBeTruthy();

  await adminPost(request, token, `/api/admin/parties/${partyId}/guests`, {
    full_name: bobName,
  });
  // A placeholder (an unnamed plus-one slot) starts with full_name equal to
  // its permanent descriptor, like the CSV import seeds them.
  await adminPost(request, token, `/api/admin/parties/${partyId}/guests`, {
    full_name: placeholder,
    placeholder_text: placeholder,
  });

  return infoToken;
}

/** Seeds a digital party with a single primary guest; returns its info token. */
async function seedDigitalParty(request: APIRequestContext): Promise<string> {
  const token = await adminToken(request);

  const party = await adminPost(request, token, "/api/admin/parties", {
    name: digitalPartyName,
    side: "madeline",
    relation: "friend",
    invitation_type: "digital",
    guest: { full_name: carolName },
  });
  return party.info_token as string;
}

/** The section (card) for one guest, located by its accessible name. */
function guestSection(page: Page, name: string) {
  return page.getByRole("region", { name });
}

test("guest completes info collection end to end: prefill, correct, remove, submit, revisit", async ({
  page,
}) => {
  const infoToken = await seedPhysicalParty(page.request);

  await page.goto(`/i/${infoToken}`, { waitUntil: "domcontentloaded" });

  // --- The greeting uses the primary's first name; fields are pre-filled ----
  await expect(page.getByRole("heading", { name: "Hi Allice!" })).toBeVisible();
  // The party's internal admin label is never shown to guests.
  await expect(page.getByText(physicalPartyName)).not.toBeVisible();

  const aliceCard = guestSection(page, bestGuessName);
  await expect(aliceCard.getByLabel(/^Name/)).toHaveValue(bestGuessName);

  // The party's +1 slot exists in the database but never surfaces here:
  // placeholders are an RSVP concern, and info collection only covers the
  // people the couple already knows.
  await expect(guestSection(page, bobName)).toBeVisible();
  await expect(page.getByText(placeholder)).not.toBeVisible();

  // A physical party's address section is present with required fields; the
  // primary's email and every real guest's name are required too.
  const addressCard = guestSection(page, "Mailing address");
  await expect(addressCard.getByLabel(/Address line 1/)).toHaveJSProperty(
    "required",
    true,
  );
  await expect(addressCard.getByLabel(/Address line 2/)).toHaveJSProperty(
    "required",
    false,
  );
  await expect(aliceCard.getByLabel(/Email/)).toHaveJSProperty(
    "required",
    true,
  );
  await expect(aliceCard.getByLabel(/^Name/)).toHaveJSProperty(
    "required",
    true,
  );

  // --- Correct the best-guess name and fill contacts -------------------------
  await aliceCard.getByLabel(/^Name/).fill(correctedName);
  await aliceCard.getByLabel(/Email/).fill("alice@example.com");
  await aliceCard.getByLabel("Phone").fill("(415) 555-2671");

  // --- Remove Bob (no longer part of the party), with inline confirmation ---
  const bobCard = guestSection(page, bobName);
  await bobCard
    .getByRole("button", { name: "No longer part of your party?" })
    .click();
  await bobCard.getByRole("button", { name: "Yes, remove" }).click();
  await expect(bobCard.getByText(/will be removed/)).toBeVisible();

  // --- Fill the mailing address and submit -----------------------------------
  // Country isn't asked on the form; it defaults to the US on submit.
  await addressCard.getByLabel(/Address line 1/).fill("123 Main St");
  await addressCard.getByLabel(/City/).fill("Springfield");
  await addressCard.getByLabel(/State/).fill("IL");
  await addressCard.getByLabel(/ZIP code/).fill("62701");

  await page.getByRole("button", { name: "Save your info" }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();

  // --- Revisiting the same link shows the saved values ----------------------
  await page.goto(`/i/${infoToken}`, { waitUntil: "domcontentloaded" });
  // The greeting picks up the corrected primary name.
  await expect(page.getByRole("heading", { name: "Hi Alice!" })).toBeVisible();
  // The removed guest is gone for good.
  await expect(page.getByText(bobName)).not.toBeVisible();

  const revisitedAlice = guestSection(page, correctedName);
  await expect(revisitedAlice.getByLabel(/^Name/)).toHaveValue(correctedName);
  await expect(revisitedAlice.getByLabel(/Email/)).toHaveValue(
    "alice@example.com",
  );
  // The backend normalized the phone to E.164; the form regroups it for display.
  await expect(revisitedAlice.getByLabel("Phone")).toHaveValue(
    "(415) 555-2671",
  );

  // The +1 slot still belongs to the party (it was never removable here), but
  // stays invisible on the revisit too.
  await expect(page.getByText(placeholder)).not.toBeVisible();

  const revisitedAddress = guestSection(page, "Mailing address");
  await expect(revisitedAddress.getByLabel(/Address line 1/)).toHaveValue(
    "123 Main St",
  );
  await expect(revisitedAddress.getByLabel(/ZIP code/)).toHaveValue("62701");
});

test("a digital party's page hides the address section entirely", async ({
  page,
}) => {
  const infoToken = await seedDigitalParty(page.request);

  await page.goto(`/i/${infoToken}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Hi Carol!" })).toBeVisible();

  // No address fields, and no note calling attention to the digital-only
  // invitation either; the primary's email is still required.
  await expect(page.getByLabel(/Address line 1/)).not.toBeVisible();
  await expect(page.getByText(/mailing address/i)).not.toBeVisible();
  await expect(
    guestSection(page, carolName).getByLabel(/Email/),
  ).toHaveJSProperty("required", true);
});

test("an unknown info token shows the invalid-link message", async ({
  page,
}) => {
  await page.goto(`/i/not-a-real-token-${stamp}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByText(/This link isn't valid/)).toBeVisible();
});
