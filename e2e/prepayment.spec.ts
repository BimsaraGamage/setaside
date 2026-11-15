import { expect, test } from "@playwright/test";
import { signInFreshToToday } from "./helpers";

// Prepayment from savings (backlog item 14, spec 5). Runs as a fresh demo user of
// its own: it checks exact totals and goes through salary day.

test("take out for a prepayment, move the payback, salary day sets aside the next one", async ({ page }) => {
  await signInFreshToToday(page);
  const tabs = page.getByRole("navigation", { name: "Main" });
  await expect(page.getByTestId("free-money")).toHaveText("Rs 90,000");

  // Savings: put in Rs 60,000.
  await tabs.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /^Savings/ }).click();
  await page.getByRole("link", { name: "Put in" }).click();
  await page.getByLabel("Amount (LKR)").fill("60000");
  await page.getByRole("button", { name: "Put in" }).click();
  await expect(page.getByTestId("savings-total")).toHaveText("Rs 60,000");

  // Take out Rs 12,000 for a year of gym, Rs 1,000 back each cycle.
  await page.getByRole("link", { name: "Take out" }).click();
  await page.getByLabel("Amount (LKR)").fill("12000");
  await page.getByRole("button", { name: "Yes, pay back" }).click();
  await page.getByLabel("What for").fill("Gym");
  await page.getByLabel("Pay back each cycle (LKR)").fill("13000");
  await expect(page.getByText("At most the whole amount.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Take out" })).toBeDisabled();
  await page.getByLabel("Pay back each cycle (LKR)").fill("1000");
  await expect(page.getByTestId("payback-cycles")).toHaveText(
    "Paid back in 12 cycles, the first set aside now.",
  );
  // Normally Rs 1,200 a month: the months start at one per payback (12) and can be changed.
  await page.getByLabel("Normal monthly price, optional (LKR)").fill("1200");
  const months = page.getByLabel("How many months it covers");
  await expect(months).toHaveValue("12");
  await expect(page.getByTestId("prepayment-saving-new")).toHaveText("Saved Rs 2,400 vs paying monthly");
  await months.fill("11");
  await expect(page.getByTestId("prepayment-saving-new")).toHaveText("Saved Rs 1,200 vs paying monthly");
  await months.fill("12");
  await expect(page.getByTestId("savings-after")).toContainText("Free money stays the same");
  await page.getByRole("button", { name: "Take out" }).click();
  await expect(page.getByRole("status")).toContainText("Gym prepayment saved");

  // Savings drop by Rs 12,000; the progress shows; the movement is listed.
  await expect(page.getByTestId("savings-total")).toHaveText("Rs 48,000");
  const gym = page.getByTestId("prepayment");
  await expect(gym).toContainText("Rs 0 of Rs 12,000");
  await expect(gym).toContainText("Rs 1,000 a cycle · 12 more cycles");
  await expect(page.getByTestId("prepayment-saving")).toHaveText("Saved Rs 2,400 vs paying monthly");
  await expect(page.getByRole("region", { name: "Movements" }).getByText("Prepayment")).toBeVisible();

  // Free money: only this cycle's payback is set aside.
  await page.getByRole("link", { name: "← Back" }).click();
  await tabs.getByRole("link", { name: "Today" }).click();
  await expect(page.getByTestId("free-money")).toHaveText("Rs 89,000");

  // Plan: the payback, moved back to savings. It has no Delete and no Every cycle.
  await tabs.getByRole("link", { name: "Plan" }).click();
  await page.getByRole("link", { name: /Gym Pays back savings Rs 1,000$/ }).click();
  await expect(page.getByText("Pays your savings back for a prepayment.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: /Every cycle/ })).toHaveCount(0);
  await page.getByRole("link", { name: "Move", exact: true }).click();
  await page.getByRole("button", { name: "Move", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Gym moved · finished");

  await page.getByRole("link", { name: "← Back" }).click();
  await tabs.getByRole("link", { name: "Money" }).click();
  await page.getByRole("link", { name: /^Savings/ }).click();
  await expect(page.getByTestId("savings-total")).toHaveText("Rs 49,000");
  await expect(gym).toContainText("Rs 1,000 of Rs 12,000");
  await expect(page.getByRole("region", { name: "Movements" }).getByText("Paid back")).toBeVisible();

  // Salary day: step 4 has the next payback, Rs 1,000, without Every cycle.
  await page.getByRole("link", { name: "← Back" }).click();
  await tabs.getByRole("link", { name: "Today" }).click();
  await page.getByRole("link", { name: "Salary arrived" }).click();
  await page.getByLabel("Salary (LKR)").fill("250000");
  while (!(await page.getByRole("heading", { name: "This cycle's commitments" }).isVisible())) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  const row = page.getByRole("group", { name: "Commitment 1" });
  await expect(row.getByLabel("Name")).toHaveValue("Gym");
  await expect(row.getByLabel("Amount (LKR)")).toHaveValue("1000");
  await expect(row.getByText("Pays your savings back for a prepayment.")).toBeVisible();
  await expect(row.getByRole("checkbox", { name: /Every cycle/ })).toHaveCount(0);
  while (!(await page.getByRole("button", { name: "Start new cycle" }).isVisible())) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await page.getByRole("button", { name: "Start new cycle" }).click();
  await expect(page.getByRole("status")).toContainText("New cycle started");
  const nextUp = page.getByRole("region", { name: "Next up · already set aside" });
  await expect(nextUp.getByText("Gym")).toBeVisible();
});
