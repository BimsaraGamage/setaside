import { expect, test } from "@playwright/test";
import { signInFresh } from "./helpers";

// Journey: two currencies (item 15, spec 8). Salary in dollars, spending in
// rupees; free dollars count toward free money at the counting rate.

test("two currencies: money held in each, a dollar bill, and a new counting rate", async ({ page }) => {
  await signInFresh(page);
  await expect(page.getByRole("heading", { name: "Welcome to Setaside" })).toBeVisible();
  await page.getByLabel("Spending currency").selectOption("LKR");
  await page.getByLabel("Salary currency").selectOption("USD");
  await page.getByLabel("Usual pay day").selectOption("25");
  await page.getByRole("button", { name: "Next" }).click();

  // Rs 10,000 and $100 held, Rs 300 a dollar.
  await page.getByLabel("Amount (LKR)").fill("10000");
  await page.getByLabel("Amount (USD)").fill("100");
  await page.getByLabel(/Counting rate/).fill("300");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // A $10 bill, set aside from the dollars.
  await page.getByRole("button", { name: "+ Add" }).click();
  const bill = page.getByRole("group", { name: "Bill 1" });
  await bill.getByLabel("Name").fill("Netflix");
  await bill.getByRole("radio", { name: "USD" }).click();
  await bill.getByLabel("Amount (USD)").fill("10");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();

  // Rs 10,000 + ($100 − $10) × 300 = Rs 37,000.
  await expect(page.getByTestId("first-use-free")).toHaveText("Rs 37,000");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 37,000");
  const nextUp = page.getByRole("region", { name: "Next up · already set aside" });
  await expect(nextUp.getByText("$10")).toBeVisible();

  // A new counting rate changes free money at once: Rs 10,000 + $90 × 310.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await tabs.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel(/Counting rate/).fill("310");
  await page.getByRole("button", { name: "Set", exact: true }).click();
  await expect(page.getByLabel(/Counting rate/)).toHaveValue("310");
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 37,900");
});
