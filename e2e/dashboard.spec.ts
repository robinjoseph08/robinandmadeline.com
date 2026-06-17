import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./auth";
import { runStamp } from "./stamp";

// Issue #12's critical E2E flow: the admin dashboard overview. Seed a guest (so
// the overview has data), then verify the dashboard renders its headline stats
// and the info-collection progress bar. The editable app settings live on their
// own page now; their round-trip is covered in settings.spec.ts.

const stamp = runStamp();
const partyName = `Dash Party ${stamp}`;
const guestName = `Dashee ${stamp}`;

test("admin views the dashboard overview", async ({ page }) => {
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
});
