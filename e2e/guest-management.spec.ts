import { expect, test, type Page } from "@playwright/test";

import { loginAsAdmin } from "./auth";

// Issue #4's critical E2E flow: admin login, create a party (born from its first
// guest), add guests including a placeholder, edit a guest, delete a guest,
// confirm a filter narrows the list, and copy the info link / RSVP code.
//
// Every entity is named with a per-run unique suffix and all assertions are
// scoped to those names, so the spec is robust against data left by earlier runs
// in the shared e2e database (no reset endpoint needed).

const stamp = Date.now().toString(36);
const partyName = `E2E Party ${stamp}`;
const alice = `Alice ${stamp}`;
const bob = `Bob ${stamp}`;
const carol = `Carol ${stamp}`;

// The clipboard copy steps read what the Copy buttons wrote.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

/** Opens the guest add row (if not already open) and fills the name field. */
async function startAddGuest(page: Page, name: string) {
  const nameField = page.getByRole("textbox", { name: "New guest name" });
  // After a successful create the add row stays open for rapid entry, so only
  // click "Add guest" when the row is not already showing.
  if (!(await nameField.isVisible())) {
    await page.getByRole("button", { name: "Add guest" }).click();
    await expect(nameField).toBeVisible();
  }
  await nameField.fill(name);
}

test("admin manages parties and guests end to end", async ({ page }) => {
  // The delete buttons use window.confirm; accept it automatically.
  page.on("dialog", (dialog) => dialog.accept());

  await loginAsAdmin(page);
  await page.goto("/admin/guests", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Guests" })).toBeVisible();

  // --- Create a party from its first (primary) guest -----------------------
  await startAddGuest(page, alice);
  await page.getByRole("combobox", { name: "New guest party" }).click();
  await page.getByPlaceholder("Search or add...").fill(partyName);
  await page.getByRole("option", { name: `Create "${partyName}"` }).click();
  await page.getByRole("combobox", { name: "New party side" }).click();
  await page.getByRole("option", { name: "Robin", exact: true }).click();
  await page.getByRole("combobox", { name: "New party relation" }).click();
  await page.getByRole("option", { name: "Family", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText(`Added ${alice} to new party ${partyName}`),
  ).toBeVisible();

  // --- Add more guests, including a placeholder ----------------------------
  await startAddGuest(page, bob);
  await page.getByRole("button", { name: "New guest flags" }).click();
  await page.getByRole("option", { name: "Placeholder" }).click();
  await page.keyboard.press("Escape"); // close the flags popover, committing it
  await page.getByRole("combobox", { name: "New guest party" }).click();
  await page.getByPlaceholder("Search or add...").fill(partyName);
  await page.getByRole("option", { name: partyName, exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(`Added ${bob}`, { exact: true })).toBeVisible();

  await startAddGuest(page, carol);
  await page.getByRole("combobox", { name: "New guest party" }).click();
  await page.getByPlaceholder("Search or add...").fill(partyName);
  await page.getByRole("option", { name: partyName, exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(`Added ${carol}`, { exact: true })).toBeVisible();

  // --- Edit a guest inline (set Alice's email), confirm it persists --------
  const search = page.getByRole("textbox", { name: "Search guests" });
  await search.fill(alice);
  const email = page.getByRole("textbox", { name: "Email", exact: true });
  await expect(email).toHaveCount(1);
  await email.fill("alice@example.com");
  await email.press("Enter");
  // Reload and re-search to confirm the PATCH persisted, not just optimistic.
  await page.reload({ waitUntil: "domcontentloaded" });
  await search.fill(alice);
  await expect(
    page.getByRole("textbox", { name: "Email", exact: true }),
  ).toHaveValue("alice@example.com");

  // --- Delete a guest ------------------------------------------------------
  await search.fill(carol);
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveValue(carol);
  await page.getByRole("button", { name: `Delete ${carol}` }).click();
  await expect(page.getByText("Guest deleted")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveCount(0);

  // --- Confirm a filter narrows the list -----------------------------------
  // Search by the run stamp so both remaining guests (matched via their shared
  // party name) are listed, then filter to placeholders and watch it narrow.
  await search.fill(stamp);
  await expect(
    page.getByRole("textbox", { name: "Name", exact: true }),
  ).toHaveCount(2);
  await page.getByRole("button", { name: "Filters" }).click();
  const sheet = page.getByRole("dialog");
  await sheet
    .getByRole("combobox", { name: "Placeholder", exact: true })
    .click();
  await page.getByRole("option", { name: "Yes", exact: true }).click();
  // Wait for the combobox popover to close before the Escape that closes the
  // sheet, so a single Escape does not just dismiss the popover.
  await expect(
    page.getByRole("option", { name: "Yes", exact: true }),
  ).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // Only the placeholder (Bob) survives the filter; Alice is gone.
  const names = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(names).toHaveCount(1);
  await expect(names).toHaveValue(bob);

  // --- Copy the info link and the RSVP code (on the parties page) ----------
  await page.goto("/admin/parties", { waitUntil: "domcontentloaded" });
  const row = await partyRow(page, partyName);

  await row
    .getByRole("button", { name: "Copy info link (marks requested)" })
    .click();
  await expect(page.getByText(/info link copied/i)).toBeVisible();
  expect(await readClipboard(page)).toContain("/i/");

  // Set an RSVP code, then copy it.
  const rsvp = `RSVP${stamp}`.toUpperCase();
  const rsvpCell = row.getByRole("textbox", { name: "RSVP code" });
  await rsvpCell.fill(rsvp);
  await rsvpCell.press("Enter");
  await row.getByRole("button", { name: "Copy RSVP code" }).click();
  await expect(page.getByText(/rsvp code copied/i)).toBeVisible();
  expect(await readClipboard(page)).toBe(rsvp);
});

/**
 * Finds the parties-grid row whose Name cell holds the given party name. The name
 * lives in an input, so it cannot be matched by row text; this checks each Name
 * input's value instead.
 */
async function partyRow(page: Page, name: string) {
  const nameInputs = page.getByRole("textbox", { name: "Name", exact: true });
  await expect(nameInputs.first()).toBeVisible();
  const count = await nameInputs.count();
  for (let i = 0; i < count; i++) {
    if ((await nameInputs.nth(i).inputValue()) === name) {
      // The enclosing row: scope row-action lookups to this one party.
      return nameInputs.nth(i).locator("xpath=ancestor::tr[1]");
    }
  }
  throw new Error(`party row not found for ${name}`);
}

/** Reads the system clipboard from the page context. */
function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}
