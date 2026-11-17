import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: delete account (backlog item 28, spec 14). A fresh demo user of its own,
// since the journey deletes it.

test("delete account: warning, download first, type DELETE, signed out with nothing left", async ({
  page,
}) => {
  await signInFreshToToday(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
  const section = page.getByRole("region", { name: "Delete account" });

  await section.getByRole("button", { name: "Delete my account…" }).click();
  await expect(section.getByRole("note")).toContainText("can't be undone");

  // Download first: the JSON file of every record.
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    section.getByRole("button", { name: "Download my data first" }).click(),
  ]);
  expect(file.suggestedFilename()).toMatch(/^setaside-data-\d{4}-\d{2}-\d{2}\.json$/);
  expect(JSON.parse(await readFile((await file.path()) ?? "", "utf8")).records.cycle).toHaveLength(1);

  // Only DELETE, exactly, lets it go.
  const confirm = section.getByLabel("Type DELETE to confirm");
  const go = section.getByRole("button", { name: "Delete my account", exact: true });
  await expect(go).toBeDisabled();
  await confirm.fill("delete");
  await expect(go).toBeDisabled();

  // Offline: told, nothing deleted.
  await confirm.fill("DELETE");
  await page.context().setOffline(true);
  await go.click();
  await expect(section.getByRole("alert")).toHaveText("Not deleted. Check the connection and try again.");
  await page.context().setOffline(false);

  await go.click();
  await expect(page.getByRole("status")).toHaveText("Your account and all its data were deleted.");
  await expect(page.getByRole("button", { name: "Sign in as demo user" })).toBeVisible();
  expect(new URL(page.url()).search).toBe("");
  // The session is gone on the server too.
  expect((await page.request.get("/api/me")).status()).toBe(401);
});
