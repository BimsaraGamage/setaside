import { expect, type Page, test } from "@playwright/test";
import { signInToToday } from "./helpers";

// Journey: pots (backlog item 7, spec 4 and 16). Names are unique per run,
// because a local run shares one demo user between the two browsers.

async function typeAmount(page: Page, digits: string) {
  const sheet = page.getByRole("dialog");
  for (const d of digits) await sheet.getByRole("button", { name: d, exact: true }).click();
}

test("make a pot, spend from it, use it up, stop using it", async ({ page }) => {
  const name = `Food ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const main = page.getByRole("navigation", { name: "Main" });
  await signInToToday(page);

  // A new Rs 1,000 pot; the usual amount follows this cycle's amount.
  await main.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: "+ New pot" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Amount this cycle (LKR)").fill("1000");
  await expect(page.getByLabel("Usual amount (LKR)")).toHaveValue("1000");
  await expect(page.getByTestId("pot-after")).toContainText("You can spend today after this");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText(`${name} pot saved`);
  const planRow = page.getByRole("link", { name: new RegExp(name) });
  await expect(planRow).toContainText("Rs 1,000 left of Rs 1,000");

  // A Rs 600 spend from the pot: the live line says it comes from the pot.
  await main.getByRole("link", { name: "Today" }).click();
  const todayRow = page.getByRole("region", { name: "Pots" }).getByTestId("pot").filter({ hasText: name });
  await expect(todayRow).toContainText("Rs 1,000 left of Rs 1,000");
  // At phone width the verdict chip stays a one-line pill and the name stays on
  // one line; the left line wraps under them instead of squeezing them.
  await page.setViewportSize({ width: 411, height: 860 });
  const chip = await todayRow.getByTestId("verdict").boundingBox();
  expect(chip?.height ?? 0).toBeGreaterThan(0);
  expect(chip?.height ?? 0).toBeLessThan(40);
  const potName = await todayRow.getByTestId("pot-name").boundingBox();
  expect(potName?.height ?? 0).toBeGreaterThan(0);
  expect(potName?.height ?? 0).toBeLessThan(30);
  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  await expect(sheet.getByRole("button", { name: "Free money" })).toHaveAttribute("aria-pressed", "true");
  await typeAmount(page, "600");
  await sheet.getByRole("button", { name, exact: true }).click();
  await expect(sheet.getByTestId("sheet-left")).toHaveText(`From ${name} pot · Rs 400 left in it`);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend saved");
  await expect(todayRow).toContainText("Rs 400 left of Rs 1,000");

  // Rs 700 more: the pot is used up, Rs 300 comes from free money.
  await page.getByRole("button", { name: "Add a spend" }).click();
  await typeAmount(page, "700");
  await sheet.getByRole("button", { name, exact: true }).click();
  await expect(sheet.getByTestId("sheet-left")).toContainText(`${name} used up · `);
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend saved");
  await expect(todayRow).toContainText("Used up · over by Rs 300");

  // The pot page lists its spends; with spends it can be stopped, not deleted.
  await main.getByRole("link", { name: "Plan" }).click();
  await planRow.click();
  const spends = page.getByRole("region", { name: "Spends from this pot" });
  await expect(spends.getByRole("button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await page.getByRole("button", { name: "Stop using this pot" }).click();
  await expect(page.getByRole("status")).toContainText(`Stopped using ${name}`);
  await expect(page.getByRole("region", { name: "Pots not in use" }).getByText(name)).toBeVisible();

  // No longer on Today or on the + sheet.
  await main.getByRole("link", { name: "Today" }).click();
  await expect(todayRow).toHaveCount(0);
  await page.getByRole("button", { name: "Add a spend" }).click();
  await expect(sheet.getByRole("button", { name, exact: true })).toHaveCount(0);
});
