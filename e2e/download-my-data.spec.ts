import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: download my data (backlog item 27, spec 14). A fresh demo user of its
// own, so the files hold only what this journey saved.

test("download my data: one JSON file with every record, and a CSV of spends", async ({ page }) => {
  await signInFreshToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });

  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  for (const d of "1850.50") {
    await sheet.getByRole("button", { name: d === "." ? "Point" : d, exact: true }).click();
  }
  await sheet.getByLabel("Note").fill("Rice, dhal");
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend saved");

  await tabs.getByRole("link", { name: "Settings" }).click();
  const yourData = page.getByRole("region", { name: "Your data" });

  const [json] = await Promise.all([
    page.waitForEvent("download"),
    yourData.getByRole("button", { name: /Download my data/ }).click(),
  ]);
  expect(json.suggestedFilename()).toMatch(/^setaside-data-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await readFile((await json.path()) ?? "", "utf8"));
  expect(data.app).toBe("setaside");
  expect(data.records.spend).toHaveLength(1);
  expect(data.records.spend[0]).toMatchObject({ amountMinor: 185_050, note: "Rice, dhal" });
  expect(data.records.cycle).toHaveLength(1);

  const [csv] = await Promise.all([
    page.waitForEvent("download"),
    yourData.getByRole("button", { name: /Download spends/ }).click(),
  ]);
  expect(csv.suggestedFilename()).toMatch(/^setaside-spends-\d{4}-\d{2}-\d{2}\.csv$/);
  const lines = (await readFile((await csv.path()) ?? "", "utf8")).replace(/^﻿/, "").split("\r\n");
  expect(lines[0]).toBe("Date,Amount,Currency,Note,Pot,Card,One-off,Cycle started");
  expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},1850\.50,LKR,"Rice, dhal",,,,\d{4}-\d{2}-\d{2}$/);

  // Offline: told, nothing breaks.
  await page.context().setOffline(true);
  await yourData.getByRole("button", { name: /Download spends/ }).click();
  await expect(yourData.getByRole("alert")).toHaveText("Not downloaded. Check the connection and try again.");
  await page.context().setOffline(false);
});
