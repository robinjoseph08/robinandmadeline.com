import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

import { ADMIN_PASSWORD, ADMIN_USERNAME } from "./auth";

// Issue #8's critical E2E flow: a guest opens their party's personalized
// /i/:token link, sees their party members' names pre-filled, corrects a
// best-guess name, fills in contact details and (for a physical party) the
// mailing address, names the placeholder slot, removes a guest who is no
// longer part of the party, and submits. A revisit of the same link shows the
// saved values, with the removed guest gone. A digital party's page hides the
// address section behind a note instead of requiring it.
//
// Fixtures are seeded through the real admin API (no test-only endpoints).
// Every entity carries a per-run unique suffix and all assertions are scoped
// to those names, so the spec is robust against data left by earlier runs in
// the shared e2e database.

const stamp = Date.now().toString(36);
const physicalPartyName = `E2E Info Party ${stamp}`;
const bestGuessName = `Allice R ${stamp}`;
const correctedName = `Alice R ${stamp}`;
const bobName = `Bob R ${stamp}`;
const placeholder = `Guest of Alice ${stamp}`;
const danaName = `Dana Lee ${stamp}`;
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
 * a placeholder slot, returning its info token.
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

  // --- The greeting names every party member; fields are pre-filled ---------
  await expect(
    page.getByRole("heading", {
      name: `Hi ${bestGuessName}, ${bobName} & ${placeholder}!`,
    }),
  ).toBeVisible();
  // The party's internal admin label is never shown to guests.
  await expect(page.getByText(physicalPartyName)).not.toBeVisible();

  const aliceCard = guestSection(page, bestGuessName);
  await expect(aliceCard.getByLabel("Name", { exact: true })).toHaveValue(
    bestGuessName,
  );

  // A physical party's address section is present with required fields; the
  // primary's email is required too.
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

  // --- Correct the best-guess name, fill contacts, name the placeholder -----
  await aliceCard.getByLabel("Name", { exact: true }).fill(correctedName);
  await aliceCard.getByLabel(/Email/).fill("alice@example.com");
  await aliceCard.getByLabel("Phone").fill("(415) 555-2671");

  const placeholderCard = guestSection(page, placeholder);
  await expect(placeholderCard.getByLabel("Name", { exact: true })).toHaveValue(
    "",
  );
  await placeholderCard.getByLabel("Name", { exact: true }).fill(danaName);

  // --- Remove Bob (no longer part of the party), with inline confirmation ---
  const bobCard = guestSection(page, bobName);
  await bobCard
    .getByRole("button", { name: "No longer part of your party?" })
    .click();
  await bobCard.getByRole("button", { name: "Yes, remove" }).click();
  await expect(bobCard.getByText(/will be removed/)).toBeVisible();

  // --- Fill the mailing address and submit -----------------------------------
  await addressCard.getByLabel(/Address line 1/).fill("123 Main St");
  await addressCard.getByLabel(/City/).fill("Springfield");
  await addressCard.getByLabel(/State or province/).fill("IL");
  await addressCard.getByLabel(/Postal code/).fill("62701");
  await addressCard.getByLabel(/Country/).fill("USA");

  await page.getByRole("button", { name: "Save your info" }).click();
  await expect(page.getByRole("heading", { name: "Thank you!" })).toBeVisible();

  // --- Revisiting the same link shows the saved values ----------------------
  await page.goto(`/i/${infoToken}`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: `Hi ${correctedName} & ${danaName}!` }),
  ).toBeVisible();
  // The removed guest is gone for good.
  await expect(page.getByText(bobName)).not.toBeVisible();

  const revisitedAlice = guestSection(page, correctedName);
  await expect(revisitedAlice.getByLabel("Name", { exact: true })).toHaveValue(
    correctedName,
  );
  await expect(revisitedAlice.getByLabel(/Email/)).toHaveValue(
    "alice@example.com",
  );
  // The backend normalized the phone to E.164.
  await expect(revisitedAlice.getByLabel("Phone")).toHaveValue("+14155552671");

  // The named placeholder keeps its descriptor visible under the new name.
  const revisitedDana = guestSection(page, danaName);
  await expect(revisitedDana.getByText(placeholder)).toBeVisible();
  await expect(revisitedDana.getByLabel("Name", { exact: true })).toHaveValue(
    danaName,
  );

  const revisitedAddress = guestSection(page, "Mailing address");
  await expect(revisitedAddress.getByLabel(/Address line 1/)).toHaveValue(
    "123 Main St",
  );
  await expect(revisitedAddress.getByLabel(/Postal code/)).toHaveValue("62701");
});

test("a digital party's page hides the address section behind a note", async ({
  page,
}) => {
  const infoToken = await seedDigitalParty(page.request);

  await page.goto(`/i/${infoToken}`, { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: `Hi ${carolName}!` }),
  ).toBeVisible();

  // No address fields at all, just the explanation; the primary's email is
  // still required.
  await expect(page.getByLabel(/Address line 1/)).not.toBeVisible();
  await expect(
    page.getByText(/receive your invitation digitally/),
  ).toBeVisible();
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
