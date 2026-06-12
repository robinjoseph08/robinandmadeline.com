import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "./auth";
import { runStamp } from "./stamp";

// Issue #11's critical E2E flow: create an email template, compose from it,
// filter the recipients down to a known guest, preview the resolved merge
// fields, send (with confirmation), and verify the send history and the
// per-recipient detail. The e2e API runs without a Mailgun key, so the queue
// worker is off and every recipient deterministically stays Queued.
//
// Every entity is named with a per-run unique suffix and all assertions are
// scoped to those names, so the spec is robust against data left by earlier
// runs in the shared e2e database. The recipient filter uses a per-run unique
// tag, so the audience is exactly the one guest this run created.

const stamp = runStamp();
const partyName = `Email Party ${stamp}`;
const guestName = `Mailee ${stamp}`;
const guestEmail = `mailee-${stamp}@example.com`;
const tag = `etag-${stamp}`;
const templateName = `Save the Date ${stamp}`;
const subject = `Hello ${stamp}, {{guest_name}}!`;
const body = `Hi {{guest_name}} of {{party_name}}, save the date! RSVP at {{rsvp_link}}.`;

test("admin composes and sends a filtered email end to end", async ({
  page,
}) => {
  // The send button uses window.confirm; accept it automatically.
  page.on("dialog", (dialog) => dialog.accept());

  await loginAsAdmin(page);

  // --- Seed a guest with an email and a unique tag -------------------------
  await page.goto("/admin/guests", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Add guest" }).click();
  await page.getByRole("textbox", { name: "New guest name" }).fill(guestName);
  await page.getByRole("textbox", { name: "New guest email" }).fill(guestEmail);
  // Tags live in a chips popover: open it, create the tag, then close the
  // popover (Escape) so the batch commits back into the draft row.
  await page.getByRole("button", { name: "New guest tags" }).click();
  await page.getByPlaceholder("Search or add...").fill(tag);
  await page.getByRole("option", { name: `Create "${tag}"` }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByPlaceholder("Search or add...")).toBeHidden();
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

  // --- Create a template ----------------------------------------------------
  await page.goto("/admin/emails/templates", {
    waitUntil: "domcontentloaded",
  });
  await page.getByRole("button", { name: "Add template" }).click();
  await page.getByLabel("Name").fill(templateName);
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Body").fill(body);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText("Template created")).toBeVisible();
  // exact: the actions cell's accessible name also contains the template name
  // (via its Edit/Delete button labels).
  await expect(
    page.getByRole("cell", { name: templateName, exact: true }),
  ).toBeVisible();

  // --- Compose from the template, filtered to this run's tag ---------------
  await page.goto("/admin/emails/compose", { waitUntil: "domcontentloaded" });
  await page.getByRole("combobox", { name: "Template" }).click();
  await page.getByPlaceholder("Search...").fill(templateName);
  await page.getByRole("option", { name: templateName }).click();
  // Loading the template copies its subject and body into the editor.
  await expect(page.getByLabel("Subject")).toHaveValue(subject);
  await expect(page.getByLabel("Body")).toHaveValue(body);

  await page.getByLabel("Tag").fill(tag);

  // --- Preview: exactly our guest, with merge fields resolved --------------
  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page.getByText("1 recipient", { exact: true })).toBeVisible();
  await expect(page.getByText(`Hello ${stamp}, ${guestName}!`)).toBeVisible();
  // The body asserts the full rendered sample including the {{rsvp_link}}
  // URL, which observes the server's PublicBaseURL wiring end to end (the
  // harness pins PUBLIC_BASE_URL; a transposed constructor argument would
  // render a wrong link here).
  await expect(
    page.getByText(
      `Hi ${guestName} of ${partyName}, save the date! RSVP at https://robinandmadeline.com/rsvp.`,
    ),
  ).toBeVisible();
  await expect(page.getByRole("cell", { name: guestEmail })).toBeVisible();

  // --- Send (confirmation auto-accepted) lands on the send detail ----------
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/emails\/sends\//);
  await expect(
    page.getByRole("heading", { name: `Hello ${stamp}, {{guest_name}}!` }),
  ).toBeVisible();
  // "by admin" observes the sent_by audit wiring (the admin username from
  // the server config records who dispatched the send).
  await expect(page.getByText(/Sent .* by admin/)).toBeVisible();
  // The worker is off in e2e (no Mailgun key), so the recipient stays queued.
  await expect(page.getByRole("cell", { name: guestName })).toBeVisible();
  await expect(page.getByText("Queued", { exact: true })).toBeVisible();

  // --- The send history lists it with its stats -----------------------------
  await page.goto("/admin/emails", { waitUntil: "domcontentloaded" });
  const historyRow = page.getByRole("row", {
    name: new RegExp(`Hello ${stamp}`),
  });
  await expect(historyRow).toBeVisible();
  await expect(historyRow.getByText("1 queued")).toBeVisible();
});
