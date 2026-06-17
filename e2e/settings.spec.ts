import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./auth";
import { runStamp } from "./stamp";

// Issue #12's app settings, on their own admin page. Verify the RSVP deadline
// and contact email round-trip: save them, reload, and they are still there.
// Settings are global rather than per-run, so the assertion is that the saved
// values survive a reload, not that they equal a fixed seed.
//
// The contact email is stamped per run so a later run's save doesn't make an
// earlier run's assertion flaky against the shared e2e database.

const stamp = runStamp();
const contactEmail = `contact-${stamp}@example.com`;

test("admin edits the app settings end to end", async ({ page }) => {
  await loginAsAdmin(page);

  await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();

  // --- Edit and save the RSVP deadline and contact email -------------------
  await page.getByLabel("RSVP deadline").fill("2026-08-01");
  await page.getByLabel("Contact email").fill(contactEmail);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  // --- Reload: the settings persisted --------------------------------------
  await page.goto("/admin/settings", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("RSVP deadline")).toHaveValue("2026-08-01");
  await expect(page.getByLabel("Contact email")).toHaveValue(contactEmail);
});
