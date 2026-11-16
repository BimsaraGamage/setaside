import { expect, type Page, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Journey: cards and card balance (backlog item 18, spec 9 and 16). A demo user of
// its own, so free money starts at Rs 90,000.

async function typeAmount(page: Page, digits: string) {
  const sheet = page.getByRole("dialog");
  for (const d of digits) await sheet.getByRole("button", { name: d, exact: true }).click();
}

test("add a card, spend on it, add its bill and pay part of it", async ({ page }) => {
  const main = page.getByRole("navigation", { name: "Main" });
  await signInFreshToToday(page);
  await expect(page.getByTestId("free-money")).toHaveText("Rs 90,000");

  // A new card from Money.
  await main.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: "+ Add a card" }).click();
  await page.getByLabel("Name").fill("Visa");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Visa added");
  await expect(page.getByTestId("card-balance-Visa")).toContainText("Rs 0");

  // A Rs 500 card spend lowers free money at once, like cash.
  await main.getByRole("link", { name: "Today" }).click();
  await page.getByRole("button", { name: "Add a spend" }).click();
  const sheet = page.getByRole("dialog", { name: "Add a spend" });
  await typeAmount(page, "500");
  await sheet.getByLabel("Card").check();
  await sheet.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Spend saved");
  await expect(page.getByTestId("free-money")).toHaveText("Rs 89,500");

  // The card page: the balance, and the bill filled from it.
  await main.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /Visa/ }).click();
  await expect(page.getByTestId("card-balance")).toHaveText("Rs 500");
  await expect(page.getByLabel("Amount (LKR)")).toHaveValue("500");
  await page.getByRole("button", { name: "Add the bill" }).click();
  await expect(page.getByRole("status")).toContainText("Commitment saved");

  // Pay Rs 200 of it: free money stays the same, Rs 300 stays owed.
  await page.getByRole("link", { name: "Pay the bill" }).click();
  await expect(page.getByTestId("pay-held")).toBeVisible();
  await page.getByLabel("Amount paid (LKR)").fill("200");
  await expect(page.getByLabel("This finishes it")).not.toBeChecked();
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Payment saved");
  await expect(page.getByTestId("card-bill-note")).toContainText("balance Rs 300");

  await page.getByRole("link", { name: "← Back" }).click();
  await main.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 89,500");
  const nextUp = page.getByRole("region", { name: "Next up · already set aside" });
  await expect(nextUp).toContainText("Visa balance Rs 300");
  // Held money is not set aside again.
  await expect(page.getByTestId("next-up-total")).toHaveText("Rs 0");
});
