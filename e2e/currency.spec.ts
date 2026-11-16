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

test("change dollars: the rate got becomes the counting rate, and this cycle's conversions", async ({
  page,
}) => {
  await signInFresh(page);
  await page.getByLabel("Spending currency").selectOption("LKR");
  await page.getByLabel("Salary currency").selectOption("USD");
  await page.getByLabel("Usual pay day").selectOption("25");
  await page.getByRole("button", { name: "Next" }).click();
  // Rs 10,000 and $100 held, Rs 300 a dollar; no bills, no pots.
  await page.getByLabel("Amount (LKR)").fill("10000");
  await page.getByLabel("Amount (USD)").fill("100");
  await page.getByLabel(/Counting rate/).fill("300");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 40,000");

  // $50 changed into Rs 16,000: no rupee bills to cover, all of it is free money.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await tabs.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /Change USD/ }).click();
  await page.getByLabel("USD given").fill("50");
  await page.getByLabel("LKR received").fill("16000");
  await expect(page.getByTestId("conversion-rate")).toHaveText("1 USD = 320 LKR");
  await expect(page.getByTestId("conversion-free")).toHaveText("Rs 16,000");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status")).toContainText("Changed $50 into Rs 16,000");
  const list = page.getByRole("region", { name: "This cycle's conversions" });
  await expect(list).toContainText("$50 → Rs 16,000");
  await expect(page.getByLabel(/LKR for 1 USD/)).toHaveValue("320");

  // Rs 10,000 + Rs 16,000 + $50 at the new counting rate (Rs 320) = Rs 42,000.
  await page.getByRole("link", { name: "← Back" }).click();
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 42,000");
});

test("paid in the other currency: a dollar bill paid in rupees gives the dollars back", async ({ page }) => {
  await signInFresh(page);
  await page.getByLabel("Spending currency").selectOption("LKR");
  await page.getByLabel("Salary currency").selectOption("USD");
  await page.getByLabel("Usual pay day").selectOption("25");
  await page.getByRole("button", { name: "Next" }).click();
  // Rs 10,000 and $100 held, Rs 300 a dollar, a $10 bill.
  await page.getByLabel("Amount (LKR)").fill("10000");
  await page.getByLabel("Amount (USD)").fill("100");
  await page.getByLabel(/Counting rate/).fill("300");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "+ Add" }).click();
  const bill = page.getByRole("group", { name: "Bill 1" });
  await bill.getByLabel("Name").fill("Netflix");
  await bill.getByRole("radio", { name: "USD" }).click();
  await bill.getByLabel("Amount (USD)").fill("10");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 37,000");

  // Charged Rs 3,100: it counts as $10.33, so it finishes the bill.
  const tabs = page.getByRole("navigation", { name: "Main" });
  await tabs.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: /Netflix/ }).click();
  await page.getByRole("link", { name: "Pay", exact: true }).click();
  await page.getByRole("radiogroup", { name: "Paid in" }).getByRole("radio", { name: "LKR" }).click();
  await page.getByLabel("Amount paid (LKR)").fill("3100");
  await expect(page.getByTestId("pay-other")).toContainText("counts as $10.33");
  await expect(page.getByLabel("This finishes it")).toBeChecked();
  await page.getByRole("button", { name: "Pay", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Netflix paid · finished");
  await expect(page.getByRole("link", { name: /Rs 3,100 · counts as \$10\.33/ })).toBeVisible();

  // The $10 goes back to the dollars, the rupees come out of the rupees: Rs 6,900 + $100 × 300.
  await page.getByRole("link", { name: "← Back" }).click();
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 36,900");
});
