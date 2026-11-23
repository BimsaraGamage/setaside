import { expect, type Page, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: a spend to finish (SAB-76/77, spec 10): save it quickly with Finish later,
// see the Today card, finish it from there, card gone. A fresh demo user, so the count is ours.

async function typeAmount(page: Page, digits: string) {
  const sheet = page.getByRole("dialog");
  for (const d of digits) await sheet.getByRole("button", { name: d, exact: true }).click();
}

test("save a spend to finish, see it on Today, finish it, the card goes", async ({ page }) => {
  await signInFreshToToday(page);
  const toFinish = page.getByRole("region", { name: /spends? to finish/ });
  await expect(toFinish).toHaveCount(0);

  // Quick save: amount only, Finish later on.
  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  await typeAmount(page, "750");
  await sheet.getByLabel("Finish later").check();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend saved");

  // Today: the card lists it, and today's spends mark it; it already counts.
  await expect(toFinish.getByRole("heading")).toHaveText("1 spend to finish");
  await expect(toFinish.getByRole("button", { name: /no note.*Rs 750/ })).toBeVisible();
  const card = page.getByRole("region", { name: "You can spend today" });
  await expect(card.getByRole("button", { name: /To finish.*Rs 750/ })).toBeVisible();
  await expect(page.getByTestId("spent-today")).toHaveText(/^Spent Rs 750 · /);

  // Finish it from the card: the switch starts off, so Save finishes it.
  await toFinish.getByRole("button", { name: /Rs 750/ }).click();
  const change = page.getByRole("dialog", { name: "Change spend" });
  await expect(change.getByLabel("Finish later")).not.toBeChecked();
  await change.getByLabel("Note").fill("Lunch");
  await change.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend changed");

  await expect(toFinish).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Lunch Rs 750" })).toBeVisible();
});

test("save a spend to finish with no amount, see the warning, finish it (SAB-83)", async ({ page }) => {
  await signInFreshToToday(page);
  const toFinish = page.getByRole("region", { name: /spends? to finish/ });
  const card = page.getByRole("region", { name: "You can spend today" });
  const allowance = await page.getByTestId("allowance").textContent();
  await expect(page.getByTestId("no-amount")).toHaveCount(0);

  // No amount: Save waits for one until Finish later is on; the live line is hidden.
  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  await expect(sheet.getByTestId("sheet-left")).toHaveCount(0);
  await expect(sheet.getByRole("button", { name: "Save" })).toBeDisabled();
  await sheet.getByLabel("Note").fill("Taxi");
  await sheet.getByLabel("Finish later").check();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend saved");

  // Today: counted as zero, with the warning; the card and today's spends say "No amount".
  await expect(page.getByTestId("no-amount")).toHaveText("May be lower: 1 spend has no amount");
  await expect(page.getByTestId("allowance")).toHaveText(allowance ?? "");
  await expect(page.getByTestId("spent-today")).toHaveText(/^Spent Rs 0 · /);
  await expect(toFinish.getByRole("button", { name: /Taxi.*No amount/ })).toBeVisible();
  await expect(card.getByRole("button", { name: /Taxi.*To finish.*No amount/ })).toBeVisible();

  // Finish it: the amount starts empty and Finish later off, so Save needs the amount.
  await toFinish.getByRole("button", { name: /No amount/ }).click();
  const change = page.getByRole("dialog", { name: "Change spend" });
  await expect(change.getByLabel("Finish later")).not.toBeChecked();
  await expect(change.getByRole("button", { name: "Save" })).toBeDisabled();
  await typeAmount(page, "1200");
  await change.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend changed");

  await expect(toFinish).toHaveCount(0);
  await expect(page.getByTestId("no-amount")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Taxi Rs 1,200" })).toBeVisible();
  await expect(page.getByTestId("spent-today")).toHaveText(/^Spent Rs 1,200 · /);
});
