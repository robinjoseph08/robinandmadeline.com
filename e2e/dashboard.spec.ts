import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./auth";
import { runStamp } from "./stamp";

// Issue #12's critical E2E flow: the admin dashboard. Seed a guest (so the
// overview has data), then verify the dashboard renders its headline stats and
// the RSVP deadline + contact email app settings round-trip (save, reload,
// still there). Settings are global rather than per-run, so the assertion is
// that the saved values survive a reload, not that they equal a fixed seed.
//
// The contact email is stamped per run so a later run's save doesn't make an
// earlier run's assertion flaky against the shared e2e database.

const stamp = runStamp();
const partyName = `Dash Party ${stamp}`;
const guestName = `Dashee ${stamp}`;
const contactEmail = `contact-${stamp}@example.com`;

test("admin views the dashboard and edits settings end to end", async ({
  page,
}) => {
  await loginAsAdmin(page);

  // --- Seed a guest so the overview has at least one party/guest -----------
  await page.goto("/admin/guests", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add guest" }).click();
  await page.getByRole("textbox", { name: "New guest name" }).fill(guestName);
  await page.getByRole("combobox", { name: "New guest party" }).click();
  await page.getByPlaceholder("Search or add...").fill(partyName);
  await page.getByRole("option", { name: `Create "${partyName}"` }).click();
  await page.getByRole("combobox", { name: "New party side" }).click();
  await page.getByRole("option", { name: "Robin", exact: true }).click();
  await page.getByRole("combobox", { name: "New party relation" }).click();
  await page.getByRole("option", { name: "Friend", exact: true }).click();
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText(`Added ${guestName} to new party ${partyName}`),
  ).toBeVisible();

  // --- The dashboard renders its headline stats ----------------------------
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: "Dashboard", level: 1 }),
  ).toBeVisible();
  await expect(page.getByText("Total guests")).toBeVisible();
  await expect(page.getByText("Total parties")).toBeVisible();
  await expect(page.getByText("RSVP response rate")).toBeVisible();
  // The info-collection progress bar is present.
  await expect(
    page.getByRole("progressbar", { name: "Info collection progress" }),
  ).toBeVisible();

  // --- Edit and save the RSVP deadline and contact email -------------------
  await page.getByLabel("RSVP deadline").fill("2026-08-01");
  await page.getByLabel("Contact email").fill(contactEmail);
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  // --- Reload: the settings persisted --------------------------------------
  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("RSVP deadline")).toHaveValue("2026-08-01");
  await expect(page.getByLabel("Contact email")).toHaveValue(contactEmail);
});
